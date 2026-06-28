//! Core document rendering and app-state helpers for leaftext.

pub mod indexer;

use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use ammonia::Builder;
use directories::ProjectDirs;
use html_escape::{decode_html_entities, encode_double_quoted_attribute, encode_text};
use linkify::{LinkFinder, LinkKind};
use pulldown_cmark::{
    html, CodeBlockKind, CowStr, Event, HeadingLevel, LinkType, Options, Parser, Tag, TagEnd,
};
use serde::{Deserialize, Serialize};
use syntect::{
    html::{ClassStyle, ClassedHTMLGenerator},
    parsing::{SyntaxReference, SyntaxSet},
    util::LinesWithEndings,
};
use url::Url;

const MAX_RECENT_FILES: usize = 8;
const MINIMAP_LONG_LINE_CHAR_THRESHOLD: usize = 80;
const BACK_ICON_SVG: &str = include_str!("assets/arrow-left.svg");
const FORWARD_ICON_SVG: &str = include_str!("assets/arrow-right.svg");
const SETTINGS_ICON_SVG: &str = include_str!("assets/adjustments-vertical.svg");
const OPEN_LIBRARY_ICON_SVG: &str = include_str!("assets/library.svg");
const OPEN_ICON_SVG: &str = include_str!("assets/folder-open.svg");
const BRAND_LOGO_DATA_URI: &str = include_str!("assets/brand-logo.txt");
const FOOTNOTE_BACKREF_ICON_SVG: &str = include_str!("assets/arrow-uturn-left.svg");
const PRIMER_LIGHT_SELECTOR: &str = "[data-color-mode=\"light\"][data-light-theme=\"light\"],\n[data-color-mode=\"auto\"][data-light-theme=\"light\"]";
const PRIMER_DARK_SELECTOR: &str = "[data-color-mode=\"dark\"][data-dark-theme=\"dark\"],\n[data-color-mode=\"auto\"][data-light-theme=\"dark\"]";
pub const LOCAL_IMAGE_PROTOCOL: &str = "leaf-image";
const LOCAL_IMAGE_HOST: &str = "local";
const LOCAL_IMAGE_PARENT_SEGMENT: &str = "__leaf_parent__";

// Bundled JS/CSS/font assets (mermaid, KaTeX) are compiled into the binary and
// served over a dedicated custom protocol, so diagrams and math render fully
// offline — no CDN. Loaded lazily by the page only when a document needs them.
pub const LOCAL_ASSET_PROTOCOL: &str = "leaf-asset";
const MERMAID_JS: &[u8] = include_bytes!("assets/vendor/mermaid.min.js");
const KATEX_JS: &[u8] = include_bytes!("assets/vendor/katex/katex.min.js");
const KATEX_CSS: &[u8] = include_bytes!("assets/vendor/katex/katex.min.css");
const KATEX_FONTS: &[(&str, &[u8])] = &[
    (
        "KaTeX_AMS-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_AMS-Regular.woff2"),
    ),
    (
        "KaTeX_Caligraphic-Bold.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2"),
    ),
    (
        "KaTeX_Caligraphic-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2"),
    ),
    (
        "KaTeX_Fraktur-Bold.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2"),
    ),
    (
        "KaTeX_Fraktur-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2"),
    ),
    (
        "KaTeX_Main-Bold.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Main-Bold.woff2"),
    ),
    (
        "KaTeX_Main-BoldItalic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2"),
    ),
    (
        "KaTeX_Main-Italic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Main-Italic.woff2"),
    ),
    (
        "KaTeX_Main-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Main-Regular.woff2"),
    ),
    (
        "KaTeX_Math-BoldItalic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2"),
    ),
    (
        "KaTeX_Math-Italic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Math-Italic.woff2"),
    ),
    (
        "KaTeX_SansSerif-Bold.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2"),
    ),
    (
        "KaTeX_SansSerif-Italic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2"),
    ),
    (
        "KaTeX_SansSerif-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2"),
    ),
    (
        "KaTeX_Script-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Script-Regular.woff2"),
    ),
    (
        "KaTeX_Size1-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Size1-Regular.woff2"),
    ),
    (
        "KaTeX_Size2-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Size2-Regular.woff2"),
    ),
    (
        "KaTeX_Size3-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Size3-Regular.woff2"),
    ),
    (
        "KaTeX_Size4-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Size4-Regular.woff2"),
    ),
    (
        "KaTeX_Typewriter-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2"),
    ),
];

/// A bundled asset served over [`LOCAL_ASSET_PROTOCOL`].
pub struct BundledAsset {
    pub status: u16,
    pub content_type: &'static str,
    pub body: std::borrow::Cow<'static, [u8]>,
}

/// Resolve a bundled-asset request URI to its bytes (404 body when unknown).
pub fn bundled_asset_response(uri: &str) -> BundledAsset {
    match bundled_asset_bytes(uri) {
        Some((content_type, body)) => BundledAsset {
            status: 200,
            content_type,
            body: std::borrow::Cow::Borrowed(body),
        },
        None => BundledAsset {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            body: std::borrow::Cow::Borrowed(b""),
        },
    }
}

fn bundled_asset_bytes(uri: &str) -> Option<(&'static str, &'static [u8])> {
    let url = Url::parse(uri).ok()?;
    let path = url.path().trim_start_matches('/');
    match path {
        "mermaid.min.js" => Some(("text/javascript; charset=utf-8", MERMAID_JS)),
        "katex/katex.min.js" => Some(("text/javascript; charset=utf-8", KATEX_JS)),
        "katex/katex.min.css" => Some(("text/css; charset=utf-8", KATEX_CSS)),
        _ => {
            let font = path.strip_prefix("katex/fonts/")?;
            KATEX_FONTS
                .iter()
                .find(|(name, _)| *name == font)
                .map(|(_, bytes)| ("font/woff2", *bytes))
        }
    }
}

/// Webview URL for a bundled asset (mirrors the local-image URL rewrite so the
/// same scheme works across platforms).
fn bundled_asset_url(path: &str) -> String {
    let protocol_url = format!("{LOCAL_ASSET_PROTOCOL}://{LOCAL_IMAGE_HOST}/{path}");
    bundled_asset_webview_url_from_protocol_url(&protocol_url)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn bundled_asset_webview_url_from_protocol_url(url: &str) -> String {
    url.replacen(
        &format!("{LOCAL_ASSET_PROTOCOL}://"),
        &format!("http://{LOCAL_ASSET_PROTOCOL}."),
        1,
    )
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
fn bundled_asset_webview_url_from_protocol_url(url: &str) -> String {
    url.to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeMode {
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolvedTheme {
    Light,
    Dark,
}

impl ThemeMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            _ => None,
        }
    }

    pub fn parse_or_system(value: Option<&str>) -> Self {
        value.and_then(Self::parse).unwrap_or(Self::System)
    }

    pub fn storage_value(self) -> &'static str {
        match self {
            Self::System => "system",
        }
    }

    pub fn resolve(self, system_prefers_dark: bool) -> ResolvedTheme {
        match self {
            Self::System if system_prefers_dark => ResolvedTheme::Dark,
            Self::System => ResolvedTheme::Light,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocaleMode {
    System,
    En,
    ZhCn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolvedLocale {
    En,
    ZhCn,
}

impl LocaleMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "en" => Some(Self::En),
            "zh-CN" => Some(Self::ZhCn),
            _ => None,
        }
    }

    pub fn parse_or_system(value: Option<&str>) -> Self {
        value.and_then(Self::parse).unwrap_or(Self::System)
    }

    pub fn storage_value(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::En => "en",
            Self::ZhCn => "zh-CN",
        }
    }

    pub fn resolve(self, system_language: Option<&str>) -> ResolvedLocale {
        match self {
            Self::En => ResolvedLocale::En,
            Self::ZhCn => ResolvedLocale::ZhCn,
            Self::System => resolve_system_locale(system_language),
        }
    }
}

impl ResolvedLocale {
    pub fn lang(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::ZhCn => "zh-CN",
        }
    }
}

pub fn resolve_system_locale(system_language: Option<&str>) -> ResolvedLocale {
    let language = system_language
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if language.starts_with("zh") {
        ResolvedLocale::ZhCn
    } else {
        ResolvedLocale::En
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenedDocument {
    pub title: String,
    pub path: String,
    pub html: String,
    pub minimap: DocumentMinimap,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedDocument {
    pub title: String,
    pub html: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalImageResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentMinimap {
    pub line_count: usize,
    pub spans: Vec<MinimapSpan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MinimapSpan {
    pub start_line: usize,
    pub line_count: usize,
    pub category: MinimapLineCategory,
    pub structure: MinimapLineStructure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MinimapLineCategory {
    Heading,
    Paragraph,
    Blank,
    List,
    Blockquote,
    CodeFence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MinimapLineStructure {
    Short,
    Long,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentFiles {
    pub files: Vec<PathBuf>,
}

impl RecentFiles {
    pub fn record(&mut self, path: PathBuf) {
        let path = normalize_recent_path(&path);
        self.files.retain(|existing| existing != &path);
        self.files.insert(0, path);
        self.files.truncate(MAX_RECENT_FILES);
    }

    /// Drop `path` from the list (e.g. it no longer exists, so it should stop
    /// being offered). Returns whether it was present.
    pub fn forget(&mut self, path: &Path) -> bool {
        let path = normalize_recent_path(path);
        let before = self.files.len();
        self.files.retain(|existing| existing != &path);
        before != self.files.len()
    }

    /// Collapse stored entries to their normalized form, dropping duplicates
    /// while preserving order. Used on load so an older list that recorded the
    /// same file under different spellings (e.g. `app\README.md` and
    /// `app\.tmp\..\README.md`) self-heals into one entry.
    fn normalize_entries(&mut self) {
        let mut normalized: Vec<PathBuf> = Vec::with_capacity(self.files.len());
        for path in self.files.drain(..) {
            let path = normalize_recent_path(&path);
            if !normalized.contains(&path) {
                normalized.push(path);
            }
        }
        self.files = normalized;
    }
}

/// Resolve `.` and `..` in `path` lexically (without touching the filesystem)
/// so that two spellings of the same file collapse to one Recent entry. We
/// normalize lexically rather than canonicalizing so the stored path stays
/// human-readable (no `\\?\` verbatim prefix on Windows) and keeps working with
/// the OS file-reveal commands.
fn normalize_recent_path(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            // Only pop a real segment; a `..` that would escape the prefix/root
            // can't be resolved lexically, so keep it verbatim.
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    if normalized.as_os_str().is_empty() {
        path.to_path_buf()
    } else {
        normalized
    }
}

pub fn load_document(path: impl AsRef<Path>) -> io::Result<OpenedDocument> {
    let path = path.as_ref();
    let markdown = fs::read_to_string(path)?;
    Ok(opened_document_from_markdown(&markdown, path))
}

/// Render an already-loaded markdown string into an `OpenedDocument`. Split out
/// from [`load_document`] so the live-reload path can read the file once (to
/// hash-gate against unchanged content) and reuse that same string to render,
/// rather than reading the file a second time.
pub fn opened_document_from_markdown(markdown: &str, path: impl AsRef<Path>) -> OpenedDocument {
    let path = path.as_ref();
    let render_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let rendered = render_markdown_document(markdown, &render_path);

    // Append a lightweight placeholder; the real Previous/Next pager scans the
    // folder tree after the document is already on screen.
    let html = match rendered.html.strip_suffix("</article>") {
        Some(body) => format!("{body}{}</article>", pager_loading_html()),
        None => rendered.html,
    };

    OpenedDocument {
        title: rendered.title,
        path: path.display().to_string(),
        html,
        minimap: build_minimap_model(markdown),
    }
}

/// One page in the Previous/Next reading order: the file to open and the label
/// shown on the pager button.
struct PagerEntry {
    path: PathBuf,
    label: String,
}

pub fn document_pager_html(current: impl AsRef<Path>) -> String {
    pager_html(current.as_ref())
}

pub fn pager_loaded_script(path: impl AsRef<Path>, html: &str) -> String {
    let state = serde_json::json!({
        "path": path.as_ref().display().to_string(),
        "html": html,
    });
    format!("window.leafSetPager({state});")
}

fn pager_loading_html() -> &'static str {
    r#"<nav class="docs-pager docs-pager-loading" aria-label="Document navigation" aria-busy="true"><span class="docs-pager-skeleton"><span class="docs-pager-label-skeleton"></span><span class="docs-pager-title-skeleton"></span></span><span class="docs-pager-skeleton docs-pager-next"><span class="docs-pager-label-skeleton"></span><span class="docs-pager-title-skeleton"></span></span></nav>"#
}

/// Build the Previous/Next pager for `current`, mirroring the web docs viewer's
/// ordering: a depth-first walk of the document tree where, at each folder, the
/// non-README files come first (sorted by name), then each subfolder — its
/// README acting as the folder's landing page (labelled by the folder name),
/// followed by that folder's own pages.
///
/// The tree root is the highest ancestor still covered by a chain of READMEs
/// (so a nested chapter pages through its whole book). Returns an empty string
/// when the file has no neighbours (nothing to page to).
fn pager_html(current: &Path) -> String {
    let root = pager_doc_root(current);
    let entries = collect_pager_entries(&root);

    let same = |a: &Path, b: &Path| -> bool {
        a == b || matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
    };
    let position = entries.iter().position(|entry| same(&entry.path, current));

    // The root README is the landing page, not a sequential entry; opening it
    // sits before the first page (index -1, prev: none, next: first page).
    let index: isize = match position {
        Some(found) => found as isize,
        None => match readme_in(&root) {
            Some(readme) if same(&readme, current) => -1,
            _ => return String::new(),
        },
    };

    let prev = if index > 0 {
        entries.get((index - 1) as usize)
    } else {
        None
    };
    let next = entries.get((index + 1) as usize);
    if prev.is_none() && next.is_none() {
        return String::new();
    }

    let button = |entry: &PagerEntry, side: &str, kicker: &str| -> String {
        match Url::from_file_path(&entry.path) {
            Ok(url) => format!(
                r#"<a class="docs-pager-{side}" href="{href}"><span class="docs-pager-label">{kicker}</span>{title}</a>"#,
                side = side,
                href = encode_text(url.as_str()),
                kicker = kicker,
                title = encode_text(&entry.label),
            ),
            Err(_) => "<span></span>".to_string(),
        }
    };
    let prev_html = prev.map_or_else(
        || "<span></span>".to_string(),
        |entry| button(entry, "prev", "Previous"),
    );
    let next_html = next.map_or_else(
        || "<span></span>".to_string(),
        |entry| button(entry, "next", "Next"),
    );

    format!(
        r#"<nav class="docs-pager" aria-label="Document navigation">{prev_html}{next_html}</nav>"#
    )
}

/// The case-insensitive `README.md` inside `dir`, if any.
fn readme_in(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().find_map(|entry| {
        let name = entry.file_name();
        let name = name.to_str()?;
        name.eq_ignore_ascii_case("README.md").then(|| entry.path())
    })
}

/// Climb from the current file's folder to the highest ancestor whose parent is
/// no longer part of the README-covered documentation tree.
fn pager_doc_root(current: &Path) -> PathBuf {
    let mut root = current.parent().unwrap_or(current).to_path_buf();
    while let Some(parent) = root.parent() {
        if readme_in(parent).is_some() {
            root = parent.to_path_buf();
        } else {
            break;
        }
    }
    root
}

/// Depth-first collection of pager entries under `dir` (see [`pager_html`]).
/// `README.md` (folder index, added by the parent) and `GLOSSARY.md` (opened in
/// the glossary sheet, never a sequential page) are excluded as standalone pages.
fn collect_pager_entries(dir: &Path) -> Vec<PagerEntry> {
    let mut entries = Vec::new();
    collect_pager_entries_into(dir, &mut entries);
    entries
}

fn collect_pager_entries_into(dir: &Path, into: &mut Vec<PagerEntry>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut files: Vec<PathBuf> = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            let is_md = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("md"));
            if is_md
                && !name.eq_ignore_ascii_case("README.md")
                && !name.eq_ignore_ascii_case("GLOSSARY.md")
            {
                files.push(path);
            }
        }
    }

    files.sort_by(by_pager_name);
    subdirs.sort_by(by_pager_name);

    for file in files {
        let label = file
            .file_name()
            .and_then(|n| n.to_str())
            .map(pager_label)
            .unwrap_or_default();
        into.push(PagerEntry { path: file, label });
    }
    for sub in subdirs {
        if let Some(readme) = readme_in(&sub) {
            let label = sub
                .file_name()
                .and_then(|n| n.to_str())
                .map(pager_label)
                .unwrap_or_default();
            into.push(PagerEntry {
                path: readme,
                label,
            });
        }
        collect_pager_entries_into(&sub, into);
    }
}

fn by_pager_name(a: &PathBuf, b: &PathBuf) -> std::cmp::Ordering {
    let an = a
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let bn = b
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
    an.cmp(&bn)
}

/// Turn an on-disk name into a display label, matching the web `label()`: drop a
/// trailing `.md`, collapse runs of `-`/`_` to single spaces, and capitalise the
/// first letter of each word. e.g. `book-1-words--kangyur` -> `Book 1 Words Kangyur`.
fn pager_label(raw: &str) -> String {
    let base = raw
        .strip_suffix(".md")
        .or_else(|| raw.strip_suffix(".MD"))
        .unwrap_or(raw);
    let mut spaced = String::with_capacity(base.len());
    let mut prev_sep = false;
    for ch in base.chars() {
        if ch == '-' || ch == '_' {
            if !prev_sep {
                spaced.push(' ');
            }
            prev_sep = true;
        } else {
            spaced.push(ch);
            prev_sep = false;
        }
    }
    let mut out = String::with_capacity(spaced.len());
    let mut at_word_start = true;
    for ch in spaced.trim().chars() {
        if ch.is_whitespace() {
            at_word_start = true;
            out.push(ch);
        } else {
            if at_word_start {
                out.extend(ch.to_uppercase());
            } else {
                out.push(ch);
            }
            at_word_start = false;
        }
    }
    out
}

#[derive(Debug)]
pub struct OpenDocumentSuccess {
    pub document: OpenedDocument,
    pub recent_save_error: Option<RecentFilesSaveError>,
}

#[derive(Debug)]
pub struct RecentFilesSaveError {
    pub config_path: PathBuf,
    pub source: io::Error,
}

impl fmt::Display for RecentFilesSaveError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "failed to save recent files to {}: {}",
            self.config_path.display(),
            self.source
        )
    }
}

impl Error for RecentFilesSaveError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        Some(&self.source)
    }
}

#[derive(Debug)]
pub enum OpenDocumentError {
    Load { path: PathBuf, source: io::Error },
}

impl OpenDocumentError {
    pub fn path(&self) -> &Path {
        match self {
            Self::Load { path, .. } => path,
        }
    }

    pub fn reason(&self) -> &io::Error {
        match self {
            Self::Load { source, .. } => source,
        }
    }
}

impl fmt::Display for OpenDocumentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Load { path, source } => {
                write!(formatter, "failed to open {}: {}", path.display(), source)
            }
        }
    }
}

impl Error for OpenDocumentError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Load { source, .. } => Some(source),
        }
    }
}

pub fn open_document_with_recent(
    path: impl AsRef<Path>,
    recent: &mut RecentFiles,
    config_path: Option<&Path>,
) -> Result<OpenDocumentSuccess, OpenDocumentError> {
    let path = path.as_ref();
    let document = load_document(path).map_err(|source| OpenDocumentError::Load {
        path: path.to_path_buf(),
        source,
    })?;

    recent.record(path.to_path_buf());
    let recent_save_error = config_path.and_then(|config_path| {
        save_recent_files(config_path, recent)
            .err()
            .map(|source| RecentFilesSaveError {
                config_path: config_path.to_path_buf(),
                source,
            })
    });

    Ok(OpenDocumentSuccess {
        document,
        recent_save_error,
    })
}

pub fn render_markdown_document(markdown: &str, source_path: impl AsRef<Path>) -> RenderedDocument {
    let source_path = source_path.as_ref();
    // Detect the title from the body, past any leading frontmatter block, so the
    // tab title is the document's real heading and not the `---` metadata.
    let title_markdown = split_leading_frontmatter(markdown)
        .map(|(_, rest)| rest)
        .unwrap_or(markdown);
    let title = markdown_title(title_markdown)
        .or_else(|| {
            source_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(plain_document_title)
        })
        .unwrap_or_else(|| "Untitled document".to_string());
    let body = render_markdown_body(MarkdownSource {
        markdown,
        source_path,
    });
    let base_href = source_path
        .parent()
        .and_then(|parent| Url::from_directory_path(parent).ok())
        .map(|url| format!(r#"<base href="{}">"#, encode_text(url.as_str())))
        .unwrap_or_default();

    RenderedDocument {
        title,
        html: format!(
            r#"{base_href}<article class="document-body">{body}</article>"#,
            base_href = base_href,
            body = body
        ),
    }
}

pub fn build_minimap_model(markdown: &str) -> DocumentMinimap {
    let lines: Vec<&str> = markdown.lines().collect();
    let mut spans: Vec<MinimapSpan> = Vec::new();
    let mut fence: Option<MinimapFence> = None;

    for (line_index, line) in lines.iter().enumerate() {
        let category = minimap_line_category(&lines, line_index, &mut fence);
        let structure = minimap_line_structure(line);

        if let Some(span) = spans.last_mut() {
            if span.category == category && span.structure == structure {
                span.line_count += 1;
                continue;
            }
        }

        spans.push(MinimapSpan {
            start_line: line_index,
            line_count: 1,
            category,
            structure,
        });
    }

    DocumentMinimap {
        line_count: lines.len(),
        spans,
    }
}

pub fn app_shell_html() -> String {
    r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https: http://leaf-image.local leaf-image: data:; script-src 'self' 'unsafe-inline' http://leaf-asset.local leaf-asset:; style-src 'self' 'unsafe-inline' http://leaf-asset.local leaf-asset:; font-src 'self' data: http://leaf-asset.local leaf-asset:">
<title>Leaf Text</title>
<script>{{THEME_BOOTSTRAP_SCRIPT}}</script>
<script>{{LOCALE_BOOTSTRAP_SCRIPT}}</script>
<link rel="stylesheet" href="{{KATEX_CSS_URL}}">
<style>{{READING_MODE_CSS}}</style>
</head>
<body>
<header id="appBar" class="app-bar">
  <button type="button" id="homeButton" class="brand-button" data-i18n-aria-label="actions.home" data-i18n-title="actions.home.title" aria-label="Home" title="Home">
    <img class="brand" src="{{BRAND_LOGO}}" alt="Leaf Text" />
  </button>
  <nav class="history-actions" aria-label="Document history">
    <button type="button" id="backButton" class="icon-button history-button" data-i18n-aria-label="actions.back" data-i18n-title="actions.back.title" aria-label="Back" title="Back" disabled>
      {{BACK_ICON_SVG}}
    </button>
    <button type="button" id="forwardButton" class="icon-button history-button" data-i18n-aria-label="actions.forward" data-i18n-title="actions.forward.title" aria-label="Forward" title="Forward" disabled>
      {{FORWARD_ICON_SVG}}
    </button>
  </nav>
  <div class="tab-bar" id="tabBar" role="tablist" aria-label="Open documents"></div>
  <div class="app-actions">
    <details class="settings-menu" id="settingsMenu">
      <summary id="settingsSummary" class="icon-button" data-i18n-aria-label="settings.heading" data-i18n-title="settings.heading" aria-label="Settings" title="Settings">
        {{SETTINGS_ICON_SVG}}
      </summary>
      <div class="settings-panel" role="group" aria-labelledby="settingsSummary">
        <label class="setting-control" for="themeMode">
          <span class="setting-label" data-i18n="settings.theme.label">Theme</span>
          <select id="themeMode" aria-label="Theme" aria-describedby="themeModeHelp">
            <option value="system" data-i18n="settings.theme.system">System</option>
            <option value="light" data-i18n="settings.theme.light">Light</option>
            <option value="dark" data-i18n="settings.theme.dark">Dark</option>
            <option value="dracula" data-i18n="settings.theme.dracula">Dracula</option>
          </select>
          <span class="setting-help" id="themeModeHelp" data-i18n="settings.theme.help">System follows device preference.</span>
        </label>
        <label class="setting-control setting-control-inline" for="minimapEnabled">
          <input type="checkbox" id="minimapEnabled" aria-label="Show document minimap" aria-describedby="minimapEnabledHelp">
          <span class="setting-label" data-i18n="settings.minimap.label">Show minimap</span>
          <span class="setting-help" id="minimapEnabledHelp" data-i18n="settings.minimap.help">Show a scrollable document overview on wider windows.</span>
        </label>
        <label class="setting-control setting-control-inline" for="pagerEnabled">
          <input type="checkbox" id="pagerEnabled" aria-label="Show next and previous links" aria-describedby="pagerEnabledHelp">
          <span class="setting-label">Show next/previous</span>
          <span class="setting-help" id="pagerEnabledHelp">Add Previous and Next links at the bottom of each document, ordered by the folder tree.</span>
        </label>
        <label class="setting-control setting-control-inline" for="speedReaderEnabled">
          <input type="checkbox" id="speedReaderEnabled" aria-label="Speed Reader" aria-describedby="speedReaderEnabledHelp">
          <span class="setting-label" data-i18n="settings.speedReader.label">Speed Reader</span>
          <span class="setting-help" id="speedReaderEnabledHelp" data-i18n="settings.speedReader.help">Make prose quieter and add bold lead anchors for faster scanning.</span>
        </label>
        <label class="setting-control setting-control-inline" for="indexingEnabled">
          <input type="checkbox" id="indexingEnabled" aria-describedby="indexingEnabledHelp">
          <span class="setting-label" data-i18n="settings.indexing.label">Index entire device</span>
          <span class="setting-help" id="indexingEnabledHelp" data-i18n="settings.indexing.help">Crawl this device for Markdown files and rescan each time you open the app.</span>
        </label>
      </div>
    </details>
    <button type="button" id="openButton" class="icon-button open-button" data-i18n-aria-label="actions.open" data-i18n-title="actions.open.title" aria-label="Open" title="Open Markdown file">{{OPEN_ICON_SVG}}</button>
  </div>
</header>
<div id="libraryShell" class="library-shell">
<aside id="libraryPane" class="library-pane">
  <div class="library-scroll">
    <div id="librarySearchResults" class="library-results" hidden></div>
    <div id="libraryTree" class="library-tree"></div>
    <div id="libraryScanProgress" class="library-progress" aria-live="polite" hidden></div>
  </div>
  <div class="library-header">
    <div class="library-view-select" id="libraryViewSelect">
      <button type="button" id="libraryViewToggle" data-i18n-title="library.view.toggle" title="Switch library view" aria-haspopup="listbox" aria-expanded="false">
        <span id="libraryViewLabel">All files</span>
        <span class="library-view-caret" aria-hidden="true">▾</span>
      </button>
      <ul id="libraryViewMenu" class="library-view-menu" role="listbox" hidden></ul>
    </div>
    <input id="librarySearch" class="library-search" type="search" autocomplete="off" spellcheck="false" data-i18n-placeholder="library.search.placeholder" placeholder="Search files...">
  </div>
  <div id="libraryDivider" class="library-divider" data-i18n-title="library.divider.resize" title="Resize library" role="separator" aria-orientation="vertical"></div>
</aside>
<main id="app" class="reader-shell"></main>
<button type="button" id="libraryOpen" class="library-open" data-i18n-title="library.open" data-i18n-aria-label="library.open" title="Open library" aria-label="Open library">{{OPEN_LIBRARY_ICON_SVG}}</button>
</div>
<div id="glossaryBackdrop" class="glossary-backdrop" hidden></div>
<aside id="glossarySheet" class="glossary-sheet" role="dialog" aria-modal="true" aria-label="Glossary" hidden>
  <div class="glossary-sheet-grip"></div>
  <button type="button" id="glossarySheetClose" class="glossary-sheet-close" aria-label="Close glossary"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
  <div id="glossarySheetBody" class="glossary-sheet-body document-body"></div>
  <div class="glossary-sheet-footer"><button type="button" id="glossaryFullLink" class="glossary-sheet-fulllink">Open the full glossary</button></div>
</aside>
<script>
const app = document.getElementById('app');
const tabBar = document.getElementById('tabBar');
const homeButton = document.getElementById('homeButton');
const backButton = document.getElementById('backButton');
const forwardButton = document.getElementById('forwardButton');
const themeModeControl = document.getElementById('themeMode');
const minimapEnabledControl = document.getElementById('minimapEnabled');
const pagerEnabledControl = document.getElementById('pagerEnabled');
const speedReaderEnabledControl = document.getElementById('speedReaderEnabled');
const indexingEnabledControl = document.getElementById('indexingEnabled');
const libraryShell = document.getElementById('libraryShell');
const libraryPane = document.getElementById('libraryPane');
const libraryDivider = document.getElementById('libraryDivider');
const libraryOpen = document.getElementById('libraryOpen');
const libraryTree = document.getElementById('libraryTree');
const libraryViewToggle = document.getElementById('libraryViewToggle');
const libraryViewLabel = document.getElementById('libraryViewLabel');
const libraryViewSelect = document.getElementById('libraryViewSelect');
const libraryViewMenu = document.getElementById('libraryViewMenu');
const librarySearch = document.getElementById('librarySearch');
const librarySearchResults = document.getElementById('librarySearchResults');
const libraryScanProgress = document.getElementById('libraryScanProgress');
const settingsMenu = document.getElementById('settingsMenu');
let tabDrag = null;
let suppressTabClick = false;
tabBar.addEventListener('wheel', (event) => {
  if (event.deltaY === 0) return;
  if (tabBar.scrollWidth <= tabBar.clientWidth) return;
  event.preventDefault();
  tabBar.scrollLeft += event.deltaY;
}, { passive: false });
// Manual pointer-based tab reordering. WebView2 does not fire HTML5 drag
// events reliably for in-page elements, so we drive the drag ourselves and
// send a moveTab command on drop, computing the insertion slot from the
// pointer position relative to the other tabs' centers.
function tabDropIndex(clientX) {
  const before = tabDrag.others.findIndex((entry) => clientX < entry.mid);
  return before === -1 ? tabDrag.others.length : before;
}
function updateTabSlides() {
  const from = tabDrag.filteredFrom;
  const to = tabDrag.to;
  tabDrag.others.forEach((t, i) => {
    let shift = 0;
    if (from < to && i >= from && i < to) shift = -tabDrag.draggedWidth;
    else if (from > to && i >= to && i < from) shift = tabDrag.draggedWidth;
    t.el.style.transform = shift !== 0 ? 'translateX(' + shift + 'px)' : '';
  });
}
function autoScrollTabBar(clientX) {
  const rect = tabBar.getBoundingClientRect();
  const zone = 48;
  if (clientX < rect.left + zone) {
    tabBar.scrollLeft -= Math.ceil((1 - (clientX - rect.left) / zone) * 8);
  } else if (clientX > rect.right - zone) {
    tabBar.scrollLeft += Math.ceil((1 - (rect.right - clientX) / zone) * 8);
  }
}
document.addEventListener('pointermove', (event) => {
  if (!tabDrag) return;
  if (!tabDrag.moved) {
    if (Math.abs(event.clientX - tabDrag.startX) < 4) return;
    tabDrag.moved = true;
    tabDrag.el.classList.add('tab-dragging');
    try { tabDrag.el.setPointerCapture(tabDrag.pointerId); } catch (_) {}
  }
  tabDrag.el.style.transform = 'translateX(' + (event.clientX - tabDrag.startX) + 'px)';
  tabDrag.to = tabDropIndex(event.clientX);
  updateTabSlides();
  autoScrollTabBar(event.clientX);
});
function endTabDrag(commit) {
  if (!tabDrag) return;
  const drag = tabDrag;
  tabDrag = null;
  const committing = drag.moved && commit && drag.to !== drag.filteredFrom;
  if (committing) {
    // Settle the tab into its new slot immediately. The moveTab round-trip
    // re-renders the tab bar a frame or two later; without this the dragged
    // tab would first snap back to where it started and then jump to the new
    // spot once the re-render lands. Reorder the DOM ourselves with all tab
    // transitions suppressed so the slid layout from the drag cuts straight to
    // the final order with no animation, matching what the re-render produces.
    const reference = drag.others[drag.to] ? drag.others[drag.to].el : null;
    tabBar.classList.add('tabs-settling');
    drag.el.style.transform = '';
    drag.el.classList.remove('tab-dragging');
    drag.others.forEach((t) => { t.el.style.transform = ''; });
    tabBar.insertBefore(drag.el, reference);
    void tabBar.offsetWidth; // flush layout so the cut applies before transitions return
    tabBar.classList.remove('tabs-settling');
  } else {
    // No move: let the tab glide back to its resting place instead of snapping.
    drag.el.classList.remove('tab-dragging');
    drag.el.style.transform = '';
    drag.others.forEach((t) => { t.el.style.transform = ''; });
  }
  if (drag.moved) {
    suppressTabClick = true;
    setTimeout(() => { suppressTabClick = false; }, 0);
    if (committing) {
      send({ command: 'moveTab', from: drag.index, to: drag.to });
    }
  }
}
document.addEventListener('pointerup', () => endTabDrag(true));
document.addEventListener('pointercancel', () => endTabDrag(false));
const send = (message) => window.ipc.postMessage(JSON.stringify(message));
const MERMAID_SCRIPT_URL = '{{MERMAID_SCRIPT_URL}}';
const KATEX_SCRIPT_URL = '{{KATEX_SCRIPT_URL}}';
let mermaidLoadPromise = null;
let katexLoadPromise = null;
document.getElementById('openButton').addEventListener('click', () => send({ command: 'open' }));
homeButton.addEventListener('click', () => send({ command: 'goHome' }));
// Right-click menu for library file rows. Every item acts on the row's path.
// Layout groups: open, clipboard (cut/copy/copy path), rename, locate
// (reveal/properties), and the destructive delete last, set off by separators.
const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
contextMenu.hidden = true;
contextMenu.setAttribute('role', 'menu');
document.body.appendChild(contextMenu);
let contextMenuPath = null;
const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const CONTEXT_MENU_ITEMS = [
  { action: 'open', labelKey: 'actions.open' },
  'separator',
  { action: 'cut', labelKey: 'actions.cut' },
  { action: 'copy', labelKey: 'actions.copy' },
  { action: 'copyPath', labelKey: 'actions.copyPath' },
  'separator',
  { action: 'rename', labelKey: 'actions.rename' },
  'separator',
  { action: 'reveal', labelKey: 'actions.revealFile' },
  { action: 'properties', labelKey: isMacPlatform ? 'actions.getInfo' : 'actions.properties' },
  'separator',
  { action: 'delete', labelKey: 'actions.delete', danger: true },
];
function hideContextMenu() {
  if (contextMenu.hidden) {
    return;
  }
  contextMenu.hidden = true;
  contextMenuPath = null;
}
function runContextAction(action, path) {
  switch (action) {
    case 'open': send({ command: 'openRecent', path }); break;
    case 'cut': send({ command: 'copyFile', path, cut: true }); break;
    case 'copy': send({ command: 'copyFile', path, cut: false }); break;
    case 'copyPath': send({ command: 'copyPath', path }); break;
    case 'reveal': send({ command: 'revealFile', path }); break;
    case 'properties': send({ command: 'showProperties', path }); break;
    case 'delete': send({ command: 'deleteFile', path }); break;
    case 'rename': openRenameBox(path); break;
  }
}
function buildContextMenu() {
  contextMenu.textContent = '';
  for (const entry of CONTEXT_MENU_ITEMS) {
    if (entry === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      sep.setAttribute('role', 'separator');
      contextMenu.appendChild(sep);
      continue;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'context-menu-item' + (entry.danger ? ' is-danger' : '');
    item.setAttribute('role', 'menuitem');
    item.textContent = window.leafLocale.t(entry.labelKey);
    item.addEventListener('click', () => {
      const path = contextMenuPath;
      hideContextMenu();
      if (path) {
        runContextAction(entry.action, path);
      }
    });
    contextMenu.appendChild(item);
  }
}
function showContextMenu(x, y, path) {
  if (!path) {
    return;
  }
  contextMenuPath = path;
  buildContextMenu();
  contextMenu.hidden = false;
  const left = Math.max(8, Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8));
  contextMenu.style.left = left + 'px';
  contextMenu.style.top = top + 'px';
  const first = contextMenu.querySelector('.context-menu-item');
  if (first) {
    first.focus();
  }
}
document.addEventListener('contextmenu', (event) => {
  const target = event.target.closest('[data-reveal-path]');
  if (target) {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, target.getAttribute('data-reveal-path'));
  } else {
    hideContextMenu();
  }
});
// On macOS a Control+click is a secondary click, but unlike a two-finger
// trackpad click it also emits a trailing left-click (with ctrlKey still set)
// once the button is released. That trailing click would otherwise reach the
// dismiss handler below and close the menu the instant it appeared, or activate
// whichever item sat under the cursor. Swallow it in the capture phase so the
// menu stays put. Real follow-up clicks to pick an item are not Control-held.
document.addEventListener('click', (event) => {
  if (isMacPlatform && event.ctrlKey && !contextMenu.hidden) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);
window.addEventListener('click', hideContextMenu);
window.addEventListener('blur', hideContextMenu);
window.addEventListener('resize', hideContextMenu);
app.addEventListener('scroll', hideContextMenu, true);

// Inline rename: a small floating input prefilled with the file name. It lives
// outside the tree DOM so a live tree refresh cannot clobber it mid-edit. Enter
// commits; Escape or losing focus cancels.
const renameBox = document.createElement('div');
renameBox.className = 'rename-box';
renameBox.hidden = true;
const renameInput = document.createElement('input');
renameInput.type = 'text';
renameInput.className = 'rename-input';
renameInput.spellcheck = false;
renameInput.setAttribute('autocomplete', 'off');
renameInput.setAttribute('aria-label', 'Rename file');
renameBox.appendChild(renameInput);
document.body.appendChild(renameBox);
let renamePath = null;
let renameSettled = false;
function fileBaseName(path) {
  const parts = (path || '').split(/[\\/]/);
  return parts[parts.length - 1] || path || '';
}
function hideRenameBox() {
  if (renameBox.hidden) {
    return;
  }
  renameBox.hidden = true;
  renamePath = null;
}
function commitRename() {
  if (renameSettled || !renamePath) {
    return;
  }
  const path = renamePath;
  const newName = renameInput.value.trim();
  const current = fileBaseName(path);
  renameSettled = true;
  hideRenameBox();
  if (newName && newName !== current) {
    send({ command: 'renameFile', path, newName });
  }
}
function openRenameBox(path) {
  renamePath = path;
  renameSettled = false;
  const name = fileBaseName(path);
  renameInput.value = name;
  renameBox.hidden = false;
  // Anchor over the row if it is on screen, otherwise near the top of the pane.
  let row = null;
  libraryTree.querySelectorAll('[data-reveal-path]').forEach((el) => {
    if (el.getAttribute('data-reveal-path') === path) row = el;
  });
  const rect = row ? row.getBoundingClientRect() : null;
  const left = rect ? rect.left : 16;
  const top = rect ? rect.top : 80;
  renameBox.style.left = Math.max(8, Math.min(left, window.innerWidth - 248)) + 'px';
  renameBox.style.top = Math.max(8, Math.min(top, window.innerHeight - 48)) + 'px';
  renameInput.focus();
  // Preselect the name without its extension for a quick edit.
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    renameInput.setSelectionRange(0, dot);
  } else {
    renameInput.select();
  }
}
renameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitRename();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    renameSettled = true;
    hideRenameBox();
  }
});
renameInput.addEventListener('blur', () => {
  commitRename();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideContextMenu();
  }
});
// The reader's place as a document-intrinsic anchor (heading + block + fraction)
// rather than a pixel offset, so it survives the full re-render a tab switch or
// history navigation performs. Falls back to the top when there is no document.
function currentScrollAnchor() {
  return captureReaderScrollAnchor() || { section: null, block: 0, offsetY: 0 };
}
function sendNavigationCommand(command) {
  send({ command, scroll_anchor: currentScrollAnchor() });
}
backButton.addEventListener('click', () => sendNavigationCommand('goBack'));
forwardButton.addEventListener('click', () => sendNavigationCommand('goForward'));
function isEditableMouseTarget(target) {
  const element = target instanceof Element ? target : target?.parentElement;
  return Boolean(element?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
}
function navigationCommandForMouseButton(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableMouseTarget(event.target)) {
    return null;
  }
  if (event.button === 3) {
    return 'goBack';
  }
  if (event.button === 4) {
    return 'goForward';
  }
  return null;
}
window.addEventListener('mousedown', (event) => {
  const command = navigationCommandForMouseButton(event);
  if (!command) {
    return;
  }
  event.preventDefault();
  sendNavigationCommand(command);
});
settingsMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    settingsMenu.open = false;
    settingsMenu.querySelector('summary').focus();
  }
});
document.addEventListener('click', (event) => {
  if (settingsMenu.open && !settingsMenu.contains(event.target)) {
    settingsMenu.open = false;
  }
});
let currentState = { recent: [], tabs: [], active: null, document: null };
let navigationState = { canGoBack: false, canGoForward: false };
// Subtext under the home-screen hero: the original invitation plus a handful of
// palm-leaf manuscript facts (leaves as the original pages of knowledge). One is
// chosen at random each time the home screen is shown, and the chosen key is
// kept so a language switch re-translates the same fact rather than re-rolling.
const EMPTY_DESCRIPTION_KEYS = [
  'empty.description',
  'empty.description.incised',
  'empty.description.stylus',
  'empty.description.bound',
  'empty.description.lifespan',
  'empty.description.roundLetters',
  'empty.description.lontar',
  'empty.description.coldDry',
  'empty.description.bali',
  'empty.description.printing',
];
function pickEmptyDescriptionKey() {
  return EMPTY_DESCRIPTION_KEYS[Math.floor(Math.random() * EMPTY_DESCRIPTION_KEYS.length)];
}
let emptyDescriptionKey = pickEmptyDescriptionKey();
// UI toggles (theme, minimap, indexing, library view) are persisted by the Rust
// host, which injects them as window.__leafSettings before any page script runs
// (see initial_settings_script). The app shell's opaque origin makes localStorage
// non-durable across launches, so the host owns these values: we seed from them
// synchronously here — no post-load re-apply, no flash — and report every change
// back so it can save them.
const LEAF_SETTINGS = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};
let minimapEnabled = typeof LEAF_SETTINGS.minimapEnabled === 'boolean' ? LEAF_SETTINGS.minimapEnabled : true;
const minimapListeners = new Set();
window.leafMinimap = {
  getEnabled: () => minimapEnabled,
  setEnabled(nextEnabled) {
    minimapEnabled = Boolean(nextEnabled);
    document.documentElement.dataset.minimapEnabled = String(minimapEnabled);
    minimapListeners.forEach((listener) => listener(minimapEnabled));
  },
  subscribe(listener) {
    minimapListeners.add(listener);
    listener(minimapEnabled);
    return () => minimapListeners.delete(listener);
  },
};
window.leafMinimap.setEnabled(minimapEnabled);
minimapEnabledControl.checked = window.leafMinimap.getEnabled();
minimapEnabledControl.addEventListener('change', () => {
  window.leafMinimap.setEnabled(minimapEnabledControl.checked);
  send({ command: 'setMinimapEnabled', enabled: minimapEnabledControl.checked });
});
// Previous/Next pager visibility. The pager markup is emitted into every
// document by the host; a single data-attribute on <html> shows or hides it via
// CSS, so toggling never needs a re-render. On by default.
let pagerEnabled = typeof LEAF_SETTINGS.pagerEnabled === 'boolean' ? LEAF_SETTINGS.pagerEnabled : true;
function applyPagerEnabled() {
  document.documentElement.dataset.pagerEnabled = String(pagerEnabled);
}
applyPagerEnabled();
pagerEnabledControl.checked = pagerEnabled;
pagerEnabledControl.addEventListener('change', () => {
  pagerEnabled = pagerEnabledControl.checked;
  applyPagerEnabled();
  send({ command: 'setPagerEnabled', enabled: pagerEnabled });
});
const SPEED_READER_SKIP_SELECTOR = [
  'code',
  'pre',
  'kbd',
  'samp',
  'script',
  'style',
  'textarea',
  'input',
  'select',
  'button',
  'svg',
  'math',
  '.katex',
  '.mermaid',
  '.settings-menu',
  '.library-pane',
  '.tab-bar',
  '.app-bar',
  '.document-minimap',
  '.glossary-sheet',
  '.docs-pager',
  '[data-speed-reader-skip]',
  '.speed-reader-anchor',
].join(',');
const speedReaderSegmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
function speedReaderGraphemes(text) {
  if (speedReaderSegmenter) {
    return Array.from(speedReaderSegmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
}
function speedReaderHasCjk(text) {
  return /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text);
}
function isSpeedReaderWord(word) {
  if (word.length < 2 || speedReaderHasCjk(word)) {
    return false;
  }
  return /^\p{L}+(?:['\u2019]\p{L}+)?$/u.test(word);
}
// An all-uppercase word (HTML, GFM, JSON) is an acronym read as a single unit,
// so it is bolded whole rather than split into a lead prefix and a dim tail.
function isSpeedReaderAcronym(word) {
  return /^\p{Lu}+$/u.test(word);
}
function leadAnchorPrefixLength(count) {
  if (count <= 1) return 0;
  if (count <= 3) return 1;
  if (count <= 5) return 2;
  if (count <= 8) return 3;
  if (count <= 12) return 4;
  return Math.min(6, Math.ceil(count * 0.35));
}
function appendSpeedReaderWord(fragment, word) {
  const chars = speedReaderGraphemes(word);
  const prefixLength = isSpeedReaderAcronym(word) ? chars.length : leadAnchorPrefixLength(chars.length);
  if (prefixLength === 0) {
    fragment.append(document.createTextNode(word));
    return;
  }
  const anchor = document.createElement('span');
  anchor.className = 'speed-reader-anchor';
  anchor.textContent = chars.slice(0, prefixLength).join('');
  fragment.append(anchor, document.createTextNode(chars.slice(prefixLength).join('')));
}
function appendSpeedReaderCandidate(fragment, token) {
  const parts = token.split(/(-)/);
  parts.forEach((part) => {
    if (!part) return;
    if (part === '-' || !isSpeedReaderWord(part)) {
      fragment.append(document.createTextNode(part));
      return;
    }
    appendSpeedReaderWord(fragment, part);
  });
}
function isSpeedReaderWordChar(char) {
  return Boolean(char && /[\p{L}\p{N}]/u.test(char));
}
// A token is part of a code-like run — and so should not get a lead anchor —
// only when a digit is fused to it (page2, COVID19) or a joiner punctuation
// glues it to another word character on the joiner's far side (file.md, a@b,
// x=y, v1.2). A joiner against whitespace, the end of the text, or sentence
// punctuation (a trailing period, comma, colon, …) is ordinary prose, so words
// ending a sentence still get anchored.
const SPEED_READER_JOINER = /[:/\\._@#?=&%+~]/;
function speedReaderTouchesCode(text, start, end) {
  const before = text[start - 1];
  const after = text[end];
  if (/[0-9]/.test(before || '') || /[0-9]/.test(after || '')) return true;
  if (SPEED_READER_JOINER.test(before || '') && isSpeedReaderWordChar(text[start - 2])) return true;
  if (SPEED_READER_JOINER.test(after || '') && isSpeedReaderWordChar(text[end + 1])) return true;
  return false;
}
function speedReaderFragment(text) {
  const fragment = document.createDocumentFragment();
  const tokenPattern = /\p{L}+(?:['\u2019-]\p{L}+)*/gu;
  let cursor = 0;
  let changed = false;
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index || 0;
    if (index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
    }
    if (speedReaderTouchesCode(text, index, index + token.length)) {
      fragment.append(document.createTextNode(token));
      cursor = index + token.length;
      continue;
    }
    const before = fragment.childNodes.length;
    appendSpeedReaderCandidate(fragment, token);
    changed = changed || fragment.childNodes.length !== before + 1 || fragment.lastChild?.textContent !== token;
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }
  return changed ? fragment : null;
}
function shouldSkipSpeedReaderTextNode(node, root) {
  if (!node.nodeValue || !node.nodeValue.trim()) {
    return true;
  }
  if (!/\p{L}/u.test(node.nodeValue)) {
    return true;
  }
  const parent = node.parentElement;
  if (!parent || parent.closest(SPEED_READER_SKIP_SELECTOR)) {
    return true;
  }
  return !root.contains(parent);
}
function applySpeedReaderToDocument(root = app.querySelector('.document-body')) {
  if (!speedReaderEnabled || !root || root.dataset.speedReaderProcessed === 'true') {
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipSpeedReaderTextNode(node, root) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node);
  }
  nodes.forEach((node) => {
    const fragment = speedReaderFragment(node.nodeValue || '');
    if (fragment) {
      node.replaceWith(fragment);
    }
  });
  root.dataset.speedReaderProcessed = 'true';
}
let speedReaderEnabled = LEAF_SETTINGS.speedReaderEnabled === true;
function setSpeedReaderEnabled(enabled) {
  speedReaderEnabled = Boolean(enabled);
  document.documentElement.dataset.speedReader = String(speedReaderEnabled);
  if (speedReaderEnabled) {
    applySpeedReaderToDocument();
  }
}
setSpeedReaderEnabled(speedReaderEnabled);
speedReaderEnabledControl.checked = speedReaderEnabled;
speedReaderEnabledControl.addEventListener('change', () => {
  setSpeedReaderEnabled(speedReaderEnabledControl.checked);
  send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });
});
// Library pane: a drill-in Project view, an expandable Tree view, and a flat
// All-files view. The host persists the chosen view, the Tree's open folders,
// and the Project view's current folder; the frontend reports each change and
// applies host values on boot. The "Index entire device" setting lives here too.
const LIBRARY_VIEWS = ['project', 'tree', 'flat'];
const VIEW_LABEL_KEY = { project: 'library.view.project', tree: 'library.view.tree', flat: 'library.view.all' };
// Markdown files are badged with the app's own leaf mark; the host substitutes
// the data URI into this string the same way it does in the header <img>.
const LEAF_FILE_ICON = "{{BRAND_LOGO}}";
let indexingEnabled = LEAF_SETTINGS.indexingEnabled === true;
let libraryView = LIBRARY_VIEWS.includes(LEAF_SETTINGS.libraryView) ? LEAF_SETTINGS.libraryView : 'project';
let libraryProjectPath = typeof LEAF_SETTINGS.libraryProjectPath === 'string' ? LEAF_SETTINGS.libraryProjectPath : '';
let expandedFolders = new Set(Array.isArray(LEAF_SETTINGS.libraryExpanded) ? LEAF_SETTINGS.libraryExpanded : []);
// Library pane open/close + resize. The user's explicit closed preference and last
// open width are host-persisted (window.__leafSettings + setLibraryLayout), the
// same path as the other settings — the app shell's opaque origin makes
// localStorage non-durable, so the host owns these too.
const SNAP_SHUT = 40;           // drag narrower than this and the pane closes
const DEFAULT_PANE_WIDTH = 240; // first-run fallback only
const MIN_READER_WIDTH = 360;   // keep the document column usable as the pane grows
let libraryUserClosed = LEAF_SETTINGS.libraryClosed === true;
let libraryWidth = Number.isFinite(LEAF_SETTINGS.libraryWidth) && LEAF_SETTINGS.libraryWidth > 0
  ? LEAF_SETTINGS.libraryWidth
  : DEFAULT_PANE_WIDTH;
let libraryTreeData = [];
let libraryError = null;
let lastScanProgress = { phase: 'idle', filesFound: 0 };
// Full-text search over the library. A non-empty query replaces the tree with
// ranked results; clearing it restores the tree (and any active view). The query
// is echoed by the backend so a slow response for an old query is dropped.
const SEARCH_DEBOUNCE_MS = 150;
let librarySearchQuery = '';
let librarySearchTimer = 0;
let librarySearchHits = null;
let librarySearchError = null;
let librarySearchLoading = false;
// A heading anchor to scroll to once a clicked result's document has rendered.
let pendingSearchJump = null;
indexingEnabledControl.checked = indexingEnabled;
indexingEnabledControl.addEventListener('change', () => {
  indexingEnabled = indexingEnabledControl.checked;
  send({ command: 'setIndexingEnabled', enabled: indexingEnabled });
});
function persistLibraryState() {
  send({
    command: 'setLibraryState',
    view: libraryView,
    expanded: Array.from(expandedFolders),
    projectPath: libraryProjectPath,
  });
}
function persistLibraryLayout() {
  send({ command: 'setLibraryLayout', closed: libraryUserClosed, width: Math.round(libraryWidth) });
}
// The widest the open pane may get while still leaving the reader usable. Floored
// at SNAP_SHUT so an explicit open always shows a real pane even on a small window.
function maxOpenPaneWidth() {
  return Math.max(SNAP_SHUT, libraryShell.clientWidth - MIN_READER_WIDTH);
}
function clampOpenPaneWidth(width) {
  return Math.min(Math.max(width, SNAP_SHUT), maxOpenPaneWidth());
}
// A window too narrow to hold both a usable reader and the pane shows the pane
// closed regardless of preference — a small-window desktop fallback, not a saved
// state. The user's explicit closed preference still wins when there IS room.
function libraryTooNarrow() {
  return libraryShell.clientWidth < SNAP_SHUT + MIN_READER_WIDTH;
}
function libraryIsClosed() {
  return libraryUserClosed || libraryTooNarrow();
}
function applyPaneLayout() {
  const closed = libraryIsClosed();
  libraryShell.classList.toggle('library-closed', closed);
  if (!closed) {
    libraryShell.style.setProperty('--library-width', clampOpenPaneWidth(libraryWidth) + 'px');
  }
}
function openLibrary() {
  libraryUserClosed = false;
  // Tapping the icon always reopens at the default width, not whatever sliver
  // the pane was dragged down to before it snapped shut.
  libraryWidth = DEFAULT_PANE_WIDTH;
  applyPaneLayout();
  persistLibraryLayout();
}
libraryOpen.addEventListener('click', openLibrary);
// Drag-to-resize the pane from its right edge. We rAF-throttle the width writes:
// the first pointermove of a frame stashes the target width and schedules a frame;
// later moves just overwrite the target until the frame applies it. This keeps the
// grid from relaying out on every pointer event.
let dividerDrag = null;
function applyPendingDividerWidth() {
  if (!dividerDrag) return;
  dividerDrag.frame = 0;
  if (dividerDrag.pendingWidth != null) {
    libraryWidth = dividerDrag.pendingWidth;
    libraryShell.style.setProperty('--library-width', libraryWidth + 'px');
  }
}
function endDividerDrag() {
  if (!dividerDrag) return;
  if (dividerDrag.frame) cancelAnimationFrame(dividerDrag.frame);
  try { libraryDivider.releasePointerCapture(dividerDrag.pointerId); } catch (_) {}
  dividerDrag = null;
  document.body.classList.remove('library-resizing');
}
libraryDivider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || libraryIsClosed()) return;
  event.preventDefault();
  dividerDrag = { pointerId: event.pointerId, frame: 0, pendingWidth: null };
  try { libraryDivider.setPointerCapture(event.pointerId); } catch (_) {}
  document.body.classList.add('library-resizing');
});
document.addEventListener('pointermove', (event) => {
  if (!dividerDrag || event.pointerId !== dividerDrag.pointerId) return;
  // Pane width is the distance from the shell's left edge to the pointer.
  const raw = event.clientX - libraryShell.getBoundingClientRect().left;
  if (raw < SNAP_SHUT) {
    // Below the threshold: snap shut and stop tracking this drag.
    endDividerDrag();
    libraryUserClosed = true;
    applyPaneLayout();
    persistLibraryLayout();
    return;
  }
  dividerDrag.pendingWidth = clampOpenPaneWidth(raw);
  if (!dividerDrag.frame) dividerDrag.frame = requestAnimationFrame(applyPendingDividerWidth);
});
document.addEventListener('pointerup', (event) => {
  if (!dividerDrag || event.pointerId !== dividerDrag.pointerId) return;
  endDividerDrag();
  persistLibraryLayout();
});
document.addEventListener('pointercancel', (event) => {
  if (!dividerDrag || event.pointerId !== dividerDrag.pointerId) return;
  endDividerDrag();
  persistLibraryLayout();
});
// On window resize, re-clamp the open width to the new window and re-evaluate the
// too-narrow fallback so the pane hides/shows as the window crosses the threshold.
// The auto-hide is a display state only; we never overwrite the saved preference,
// so widening the window again restores the pane the user wanted open.
let paneResizeFrame = 0;
window.addEventListener('resize', () => {
  if (paneResizeFrame) return;
  paneResizeFrame = requestAnimationFrame(() => {
    paneResizeFrame = 0;
    if (!libraryIsClosed()) libraryWidth = clampOpenPaneWidth(libraryWidth);
    applyPaneLayout();
  });
});
// The file the library highlights as "current" (the active tab's path), plus a
// one-shot request to reveal it on the next render: drill the Project view into
// its folder, expand its Tree ancestors, and scroll the row into view. The flag
// is only set when the user *goes to* a file (opens one, or switches/clicks a
// tab) — never on a passive re-render — so manual library browsing while a file
// is open is left where the user put it until they click that file's tab again.
let librarySelectedPath = null;
let libraryRevealPending = false;
function activeDocumentPath() {
  const tabs = (currentState && currentState.tabs) || [];
  const active = currentState && currentState.active;
  if (active == null || !tabs[active]) return null;
  return tabs[active].path || null;
}
function requestDocumentPager(path) {
  const placeholder = app.querySelector('.document-body .docs-pager-loading');
  if (!placeholder || !path) return;
  send({ command: 'loadPager', path });
}
window.leafSetPager = (state) => {
  if (!state || state.path !== activeDocumentPath()) return;
  const body = app.querySelector('.document-body');
  const current = body ? body.querySelector('.docs-pager') : null;
  if (!current) return;
  if (!state.html) {
    current.remove();
    scheduleReaderLayoutUpdate();
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.innerHTML = state.html;
  const pager = wrapper.firstElementChild;
  if (!pager) {
    current.remove();
    scheduleReaderLayoutUpdate();
    return;
  }
  current.replaceWith(pager);
  bindDocumentLinks();
  scheduleReaderLayoutUpdate();
};
// The chain of folder paths from the tree root down to (and including) the
// folder that directly contains `filePath`. Returns null when no file with that
// path exists in the tree; an empty array means the file sits at the root.
function folderAncestorsOf(nodes, filePath) {
  const walk = (list, trail) => {
    for (const node of list || []) {
      if (node.kind === 'folder') {
        const found = walk(node.children, trail.concat(node.path));
        if (found) return found;
      } else if (node.path === filePath) {
        return trail;
      }
    }
    return null;
  };
  return walk(nodes, []);
}
function scrollSelectedLibraryRowIntoView() {
  const row = libraryTree.querySelector('.library-file.is-selected');
  // Centered so a deeply nested file lands away from the app bar and bottom edge.
  if (row) row.scrollIntoView({ block: 'center' });
}
// Carry out a pending reveal. Returns false (still pending) until the tree is
// loaded, so leafSetLibraryState can retry once it arrives. When the tree is
// present we always render; if the file is found we first point the Project view
// at its folder and open its Tree ancestors so the row shows in every view.
function revealSelectedInLibrary() {
  if (!libraryRevealPending || !librarySelectedPath) return false;
  const nodes = libraryTreeData || [];
  if (!nodes.length) return false;
  libraryRevealPending = false;
  const ancestors = folderAncestorsOf(nodes, librarySelectedPath);
  if (ancestors) {
    libraryProjectPath = ancestors.length ? ancestors[ancestors.length - 1] : '';
    for (const folder of ancestors) expandedFolders.add(folder);
    persistLibraryState();
  }
  renderLibrary();
  if (ancestors) scrollSelectedLibraryRowIntoView();
  return true;
}
// Mark `path` as the library's current file and ask the next render to reveal
// it. Passing null (the home screen, no active file) just clears the highlight;
// the Project/Tree position is left exactly as the user last had it.
function followFileInLibrary(path) {
  librarySelectedPath = path || null;
  libraryRevealPending = !!path;
  if (libraryRevealPending) {
    if (!revealSelectedInLibrary()) renderLibrary();
  } else {
    renderLibrary();
  }
}
// The view picker is a dropdown listbox: the button shows the active view and a
// caret; clicking opens a menu of the three views, and choosing one switches.
function closeLibraryViewMenu() {
  libraryViewMenu.hidden = true;
  libraryViewToggle.setAttribute('aria-expanded', 'false');
}
function openLibraryViewMenu() {
  libraryViewMenu.hidden = false;
  libraryViewToggle.setAttribute('aria-expanded', 'true');
}
function renderLibraryViewMenu() {
  libraryViewMenu.innerHTML = LIBRARY_VIEWS.map((view) => {
    const selected = view === libraryView;
    return `<li role="option" class="library-view-option" data-view="${view}" aria-selected="${selected}">${escapeText(window.leafLocale.t(VIEW_LABEL_KEY[view]))}</li>`;
  }).join('');
}
libraryViewToggle.addEventListener('click', () => {
  if (libraryViewMenu.hidden) {
    renderLibraryViewMenu();
    openLibraryViewMenu();
  } else {
    closeLibraryViewMenu();
  }
});
libraryViewMenu.addEventListener('click', (event) => {
  const option = event.target.closest('[data-view]');
  if (!option) return;
  libraryView = option.dataset.view;
  closeLibraryViewMenu();
  persistLibraryState();
  renderLibrary();
});
document.addEventListener('click', (event) => {
  if (!libraryViewMenu.hidden && !libraryViewSelect.contains(event.target)) {
    closeLibraryViewMenu();
  }
});
function applyScanProgress(progress) {
  lastScanProgress = progress || { phase: 'idle', filesFound: 0 };
  if (lastScanProgress.phase === 'scanning') {
    const count = window.leafLocale.formatNumber(lastScanProgress.filesFound || 0);
    libraryScanProgress.textContent = window.leafLocale.t('library.scanning') + ' ' + window.leafLocale.t('library.filesFound', { count });
    libraryScanProgress.hidden = false;
  } else {
    libraryScanProgress.hidden = true;
    libraryScanProgress.textContent = '';
  }
}
// A library row's display name: a file shows its file name (basename minus a
// .md-style extension), matching the tabs; a folder shows its folder name.
function fileDisplayName(node) {
  return stripMarkdownExt(node && node.name) || (node && (node.title || node.path)) || '';
}
function nodeSortKey(node) {
  const label = node && node.kind === 'folder' ? (node.name || '') : fileDisplayName(node);
  return label.toLowerCase();
}
// A Markdown file row: the leaf mark, then the file name, truncated.
function fileRowHtml(node) {
  const label = fileDisplayName(node);
  const isSelected = librarySelectedPath && node.path === librarySelectedPath;
  const selected = isSelected ? ' is-selected' : '';
  const current = isSelected ? ' aria-current="true"' : '';
  return `<button type="button" class="library-file${selected}"${current} data-open-path="${escapeAttr(node.path)}" data-reveal-path="${escapeAttr(node.path)}" title="${escapeAttr(node.path)}"><img class="library-file-icon" src="${LEAF_FILE_ICON}" alt="" aria-hidden="true"><span class="library-file-label">${escapeText(label)}</span></button>`;
}
function renderTreeNode(node) {
  if (node && node.kind === 'folder') {
    const open = expandedFolders.has(node.path) ? ' open' : '';
    return `<details class="library-folder" data-folder-path="${escapeAttr(node.path)}"${open}><summary>${escapeText(node.name)}</summary><div class="library-children">${renderTreeNodes(node.children || [])}</div></details>`;
  }
  return fileRowHtml(node);
}
function renderTreeNodes(nodes) {
  return (nodes || []).map(renderTreeNode).join('');
}
function collectLibraryFiles(nodes, out) {
  for (const node of nodes || []) {
    if (node.kind === 'file') {
      out.push(node);
    } else {
      collectLibraryFiles(node.children, out);
    }
  }
  return out;
}
function renderFlatList(nodes) {
  const files = collectLibraryFiles(nodes, []);
  files.sort((a, b) => {
    const ta = nodeSortKey(a);
    const tb = nodeSortKey(b);
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return (a.path || '').localeCompare(b.path || '');
  });
  return `<div class="library-flat">${files.map(fileRowHtml).join('')}</div>`;
}
// Project (drill-in) view helpers. Folders are entered one level at a time; the
// current folder is located in the tree by its full path.
function findFolderByPath(nodes, path) {
  for (const node of nodes || []) {
    if (node.kind !== 'folder') continue;
    if (node.path === path) return node;
    const found = findFolderByPath(node.children, path);
    if (found) return found;
  }
  return null;
}
function findParentPath(nodes, path, parentPath) {
  for (const node of nodes || []) {
    if (node.kind !== 'folder') continue;
    if (node.path === path) return parentPath;
    const found = findParentPath(node.children, path, node.path);
    if (found !== null) return found;
  }
  return null;
}
function projectChildrenSorted(nodes) {
  const folders = [];
  const files = [];
  for (const node of nodes || []) {
    (node.kind === 'folder' ? folders : files).push(node);
  }
  const byName = (a, b) => nodeSortKey(a).localeCompare(nodeSortKey(b));
  folders.sort(byName);
  files.sort(byName);
  return folders.concat(files);
}
function renderProject(nodes) {
  let children = nodes;
  if (libraryProjectPath) {
    const current = findFolderByPath(nodes, libraryProjectPath);
    if (current) {
      children = current.children || [];
    } else {
      // The saved folder is gone (e.g. after a rescan); fall back to the root.
      libraryProjectPath = '';
    }
  }
  const rows = [];
  if (libraryProjectPath) {
    const current = findFolderByPath(nodes, libraryProjectPath);
    const parent = findParentPath(nodes, libraryProjectPath, '');
    const parentPath = parent === null ? '' : parent;
    const currentName = (current && current.name) || '';
    rows.push(`<button type="button" class="library-nav-up" data-nav-path="${escapeAttr(parentPath)}" title="${escapeAttr(window.leafLocale.t('library.up'))}"><span class="library-nav-arrow" aria-hidden="true">←</span><span class="library-file-label">${escapeText(currentName)}</span></button>`);
  }
  for (const node of projectChildrenSorted(children)) {
    if (node.kind === 'folder') {
      rows.push(`<button type="button" class="library-nav-folder" data-nav-into="${escapeAttr(node.path)}" title="${escapeAttr(node.name)}"><span class="library-file-label">${escapeText(node.name)}</span><span class="library-nav-chevron" aria-hidden="true">›</span></button>`);
    } else {
      rows.push(fileRowHtml(node));
    }
  }
  return `<div class="library-project">${rows.join('')}</div>`;
}
function bindLibraryRows() {
  libraryTree.querySelectorAll('[data-open-path]').forEach((button) => {
    button.addEventListener('click', () => send({ command: 'openRecent', path: button.dataset.openPath }));
  });
  libraryTree.querySelectorAll('[data-nav-into]').forEach((button) => {
    button.addEventListener('click', () => {
      libraryProjectPath = button.dataset.navInto;
      persistLibraryState();
      renderLibrary();
    });
  });
  libraryTree.querySelectorAll('[data-nav-path]').forEach((button) => {
    button.addEventListener('click', () => {
      libraryProjectPath = button.dataset.navPath;
      persistLibraryState();
      renderLibrary();
    });
  });
  libraryTree.querySelectorAll('details[data-folder-path]').forEach((details) => {
    details.addEventListener('toggle', () => {
      const path = details.dataset.folderPath;
      if (details.open) {
        expandedFolders.add(path);
      } else {
        expandedFolders.delete(path);
      }
      persistLibraryState();
    });
  });
}
function renderLibrary() {
  libraryViewLabel.textContent = window.leafLocale.t(VIEW_LABEL_KEY[libraryView]);
  if (!libraryViewMenu.hidden) renderLibraryViewMenu();
  if (libraryError) {
    libraryTree.innerHTML = `<p class="library-empty">${escapeText(libraryError.message || '')}</p>`;
    return;
  }
  const nodes = libraryTreeData || [];
  if (!nodes.length) {
    libraryTree.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.empty'))}</p>`;
    return;
  }
  if (libraryView === 'flat') {
    libraryTree.innerHTML = renderFlatList(nodes);
  } else if (libraryView === 'tree') {
    libraryTree.innerHTML = renderTreeNodes(nodes);
  } else {
    libraryTree.innerHTML = renderProject(nodes);
  }
  bindLibraryRows();
}
window.leafSetLibraryState = (state) => {
  const next = state || {};
  if (next.error) {
    libraryError = next.error;
    renderLibrary();
    return;
  }
  libraryError = null;
  if (next.tree) {
    libraryTreeData = next.tree;
  }
  if (next.progress) {
    applyScanProgress(next.progress);
  }
  // A reveal queued before the tree loaded (e.g. launching straight into a file)
  // runs here once the nodes are in hand; revealSelectedInLibrary renders itself.
  if (libraryRevealPending && revealSelectedInLibrary()) return;
  renderLibrary();
};
window.leafSetScanProgress = (progress) => {
  applyScanProgress(progress);
};
// The snippet() markers from the backend are control characters (STX/ETX) that
// cannot occur in normal Markdown, so we can escape the whole untrusted snippet
// for the DOM first and only then swap the markers for <mark> tags.
function highlightSnippet(snippet) {
  return escapeText(snippet || '')
    .split('').join('<mark class="library-hit-mark">')
    .split('').join('</mark>');
}
function searchHitHtml(hit) {
  const path = (hit && hit.absPath) || '';
  const title = (hit && hit.title) || path;
  const anchor = (hit && hit.anchor) || '';
  return `<button type="button" class="library-hit" data-open-path="${escapeAttr(path)}" data-anchor="${escapeAttr(anchor)}" title="${escapeAttr(path)}"><span class="library-hit-title">${escapeText(stripMarkdownExt(title) || title)}</span><span class="library-hit-snippet">${highlightSnippet(hit && hit.snippet)}</span></button>`;
}
function bindSearchHits() {
  librarySearchResults.querySelectorAll('[data-open-path]').forEach((button) => {
    button.addEventListener('click', () => {
      const path = button.dataset.openPath;
      const anchor = button.dataset.anchor || '';
      // Open (or focus) the file, then scroll to the matching heading once it
      // renders. Files with no heading above the match open at the top.
      pendingSearchJump = anchor ? { path, anchor } : null;
      send({ command: 'openRecent', path });
    });
  });
}
// Swap between the tree and the search results. A non-empty query shows the
// results pane (loading, error, no-results, or the ranked hits); an empty query
// restores the tree exactly as it was, including the active view and filters.
function renderLibrarySearch() {
  const active = !!librarySearchQuery;
  libraryTree.hidden = active;
  librarySearchResults.hidden = !active;
  if (!active) {
    librarySearchResults.innerHTML = '';
    return;
  }
  if (librarySearchError) {
    const message = (librarySearchError && librarySearchError.message) || window.leafLocale.t('library.search.error');
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(message)}</p>`;
    return;
  }
  if (librarySearchLoading && !librarySearchHits) {
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.search.loading'))}</p>`;
    return;
  }
  const hits = librarySearchHits || [];
  if (!hits.length) {
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.search.noResults'))}</p>`;
    return;
  }
  const count = window.leafLocale.formatNumber(hits.length);
  const countLine = `<p class="library-results-count">${escapeText(window.leafLocale.t('library.search.count', { count }))}</p>`;
  librarySearchResults.innerHTML = countLine + hits.map(searchHitHtml).join('');
  bindSearchHits();
}
function runLibrarySearch(value) {
  const query = (value || '').trim();
  librarySearchQuery = query;
  if (!query) {
    librarySearchHits = null;
    librarySearchError = null;
    librarySearchLoading = false;
    renderLibrarySearch();
    return;
  }
  librarySearchLoading = true;
  librarySearchError = null;
  renderLibrarySearch();
  send({ command: 'search', query });
}
librarySearch.addEventListener('input', () => {
  const value = librarySearch.value;
  if (librarySearchTimer) clearTimeout(librarySearchTimer);
  librarySearchTimer = window.setTimeout(() => runLibrarySearch(value), SEARCH_DEBOUNCE_MS);
});
// Escape clears the field and returns to the tree immediately.
librarySearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && librarySearch.value) {
    event.stopPropagation();
    librarySearch.value = '';
    if (librarySearchTimer) clearTimeout(librarySearchTimer);
    runLibrarySearch('');
  }
});
window.leafSetSearchResults = (payload) => {
  const data = payload || {};
  const query = typeof data.query === 'string' ? data.query : '';
  // Drop stale responses: the input has moved on since this query was sent.
  if (query !== librarySearchQuery) return;
  librarySearchLoading = false;
  if (data.error) {
    librarySearchError = data.error;
    librarySearchHits = null;
  } else {
    librarySearchError = null;
    librarySearchHits = Array.isArray(data.hits) ? data.hits : [];
  }
  renderLibrarySearch();
};
// Paint the pane from the seeded settings right away (correct view + toggle
// label), then ask for the tree. The host owns the indexing setting and starts
// the launch rescan itself when enabled, so there is no JS-initiated crawl on
// boot. Both are no-ops until the worker is ready.
renderLibrary();
applyPaneLayout();
send({ command: 'getFileTree' });
let minimapViewportFrame = 0;
let minimapPreviewFrame = 0;
let minimapPointerId = null;
let minimapPointerOffsetY = null;
let minimapBodyObserver = null;
let minimapResizeObserver = null;
let readerLayoutFrame = 0;
let readerScrollAnchor = null;
let readerReflowObserver = null;
let resetReaderScrollOnNextRender = false;
const READER_CONTENT_TOP_GAP = 88;
const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';
themeModeControl.value = window.leafTheme.getMode();
themeModeControl.addEventListener('change', () => {
  window.leafTheme.setMode(themeModeControl.value);
  send({ command: 'setThemeMode', mode: themeModeControl.value });
});
// Tell the host what the page background and divider color resolve to so it can
// paint the native title bar to match the page and the window border to the
// theme's divider color (a darker line on light themes, the blue rule on
// Dracula). Runs on every theme change, including system light/dark flips, so
// the OS chrome always tracks the document.
function reportWindowChrome(theme) {
  const shell = document.getElementById('app');
  if (!shell) {
    return;
  }
  const parts = getComputedStyle(shell).backgroundColor.match(/\d+(?:\.\d+)?/g);
  if (!parts || parts.length < 3) {
    return;
  }
  // Resolve the divider color (a var() chain) to concrete rgb via a probe.
  const probe = document.createElement('span');
  probe.style.color = 'var(--app-border)';
  shell.appendChild(probe);
  const borderParts = getComputedStyle(probe).color.match(/\d+(?:\.\d+)?/g);
  probe.remove();
  const border = borderParts && borderParts.length >= 3 ? borderParts : parts;
  send({
    command: 'setWindowChrome',
    r: Math.round(Number(parts[0])),
    g: Math.round(Number(parts[1])),
    b: Math.round(Number(parts[2])),
    borderR: Math.round(Number(border[0])),
    borderG: Math.round(Number(border[1])),
    borderB: Math.round(Number(border[2])),
    dark: theme.resolvedTheme === 'dark',
  });
}
window.leafTheme.subscribe((theme) => {
  themeModeControl.value = theme.mode;
  reportWindowChrome(theme);
});
window.leafLocale.subscribe(() => {
  renderStaticText();
  renderState();
  applyScanProgress(lastScanProgress);
  renderLibrary();
});
window.leafMinimap.subscribe((enabled) => {
  minimapEnabledControl.checked = enabled;
  renderState();
});
let composing = false;
window.addEventListener('compositionstart', () => {
  composing = true;
});
window.addEventListener('compositionupdate', () => {
  composing = true;
});
window.addEventListener('compositionend', () => {
  composing = false;
});
window.addEventListener('keydown', (event) => {
  if (event.isComposing || composing) {
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    send({ command: 'open' });
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w' && currentState.active != null) {
    event.preventDefault();
    send({ command: 'closeTab', index: currentState.active });
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
    event.preventDefault();
    const tabCount = (currentState.tabs || []).length;
    if (tabCount > 0) {
      // Cycle through the home screen plus every open tab. Position 0 is the
      // home screen; positions 1..=tabCount map to tab indices 0..tabCount-1.
      const stops = tabCount + 1;
      const current = currentState.active == null ? 0 : currentState.active + 1;
      const step = event.shiftKey ? -1 : 1;
      const next = (current + step + stops) % stops;
      if (next === 0) {
        send({ command: 'goHome' });
      } else {
        send({ command: 'switchTab', index: next - 1, scroll_anchor: currentScrollAnchor() });
      }
    }
    return;
  }
  const key = event.key;
  const isBackShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowLeft';
  const isForwardShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowRight';
  const isMacBackShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowLeft';
  const isMacForwardShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowRight';
  if (isBackShortcut || isMacBackShortcut) {
    event.preventDefault();
    sendNavigationCommand('goBack');
    return;
  }
  if (isForwardShortcut || isMacForwardShortcut) {
    event.preventDefault();
    sendNavigationCommand('goForward');
  }
});
window.leafSetState = (state) => {
  currentState = state || { recent: [], tabs: [], active: null, document: null };
  if (!currentState.document) {
    emptyDescriptionKey = pickEmptyDescriptionKey();
  }
  resetReaderScrollOnNextRender = true;
  renderState();
  // Opening a file lands on it; the home screen (no active tab) clears the
  // highlight and leaves the Project/Tree position as the user last saved it.
  followFileInLibrary(activeDocumentPath());
  // A search result was clicked: once its document is the active one, jump to the
  // matching heading. One-shot — cleared whether or not it applied this render.
  if (pendingSearchJump) {
    const jump = pendingSearchJump;
    pendingSearchJump = null;
    if (jump.anchor && activeDocumentPath() === jump.path) {
      window.leafScrollToFragment('#' + jump.anchor);
    }
  }
};
// Re-render the active document after it changed on disk (live reload) without
// scrolling back to the top: capture the current position, re-render, then put
// the reader back where it was (clamped if the document got shorter).
window.leafReloadDocument = (state) => {
  const anchor = captureReaderScrollAnchor();
  currentState = state || currentState || { recent: [], tabs: [], active: null, document: null };
  resetReaderScrollOnNextRender = false;
  renderState();
  readerScrollAnchor = anchor;
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
};
// Switch to another tab's document and land where that tab was last left. The
// position is a content anchor (heading + block + fraction), not a pixel, so it
// survives the full re-render the switch performs. `anchor` is null the first
// time a tab is opened, which starts at the top of the content. We deliberately
// skip the reset-to-content-start that leafSetState runs so clicking a tab never
// jumps to the top.
window.leafSwitchTab = (state, anchor) => {
  currentState = state || { recent: [], tabs: [], active: null, document: null };
  if (!currentState.document) {
    emptyDescriptionKey = pickEmptyDescriptionKey();
  }
  resetReaderScrollOnNextRender = false;
  renderState();
  // Switching to a tab is "going to" that file: reveal and select it.
  followFileInLibrary(activeDocumentPath());
  if (!anchor) {
    resetReaderScrollToContentStart();
    return;
  }
  readerScrollAnchor = anchor;
  // Restore synchronously, before the browser paints the freshly rendered
  // document, so switching tabs never flashes at the top for a frame.
  restoreReaderScrollAnchor(anchor);
  updateMinimapViewport();
  // Re-apply after layout settles. The reflow observer installed by renderState
  // keeps re-pinning this anchor as images above it decode and grow, so the
  // landing no longer drifts once they finish loading.
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
};
window.leafSetNavigation = (state) => {
  navigationState = state || { canGoBack: false, canGoForward: false };
  renderNavigation();
};
window.leafScrollToFragment = (fragment) => {
  const raw = String(fragment || '').replace(/^#/, '');
  if (!raw) {
    return;
  }
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    decoded = raw;
  }
  window.requestAnimationFrame(() => {
    const target = document.getElementById(decoded) || document.getElementById(raw);
    if (!target) {
      return;
    }
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
    setReaderScrollTop(app.scrollTop);
    updateMinimapViewport();
  });
};
window.leafRestoreScrollAnchor = (anchor) => {
  if (!anchor) {
    return;
  }
  readerScrollAnchor = anchor;
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
};
function renderStaticText() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = window.leafLocale.t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.title = window.leafLocale.t(node.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-label]').forEach((node) => {
    node.label = window.leafLocale.t(node.dataset.i18nLabel);
  });
  document.querySelectorAll('[aria-label][data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', window.leafLocale.t(node.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', window.leafLocale.t(node.dataset.i18nPlaceholder));
  });
  themeModeControl.setAttribute('aria-label', window.leafLocale.t('settings.theme.aria'));
  minimapEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.minimap.aria'));
  speedReaderEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.speedReader.aria'));
}
// Tabs and the library both show the file name (basename, minus a .md/.markdown
// extension), not the document's heading title. Falls back to the title, then
// the raw path.
function stripMarkdownExt(name) {
  return (name || '').replace(/\.(md|markdown|mdown|mkd)$/i, '');
}
function tabDisplayName(tab) {
  const base = (tab.path || '').split(/[\\/]/).pop() || '';
  return stripMarkdownExt(base) || tab.title || tab.path || '';
}
function renderTabs(state) {
  const tabs = state.tabs || [];
  const active = state.active;
  tabBar.innerHTML = tabs.map((tab, index) => `<span class="tab${index === active ? ' tab-active' : ''}" data-tab-pos="${index}"><button type="button" class="tab-label" data-tab-index="${index}" data-reveal-path="${escapeAttr(tab.path)}" title="${escapeAttr(tab.path)}">${escapeText(tabDisplayName(tab))}</button><button type="button" class="tab-close" data-tab-close="${index}" aria-label="${escapeAttr(window.leafLocale.t('actions.closeTab'))}" title="${escapeAttr(window.leafLocale.t('actions.closeTab'))}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></span>`).join('');
  tabBar.querySelectorAll('[data-tab-index]').forEach((button) => {
    button.addEventListener('click', () => {
      if (suppressTabClick) return;
      const index = Number(button.dataset.tabIndex);
      send({ command: 'switchTab', index, scroll_anchor: currentScrollAnchor() });
      // Reveal even when this is already the active tab (no state round-trip
      // from the host): clicking a file's tab snaps the library back to it.
      const tab = (currentState.tabs || [])[index];
      followFileInLibrary(tab ? tab.path || null : null);
    });
  });
  tabBar.querySelectorAll('[data-tab-close]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      send({ command: 'closeTab', index: Number(button.dataset.tabClose) });
    });
  });
  tabBar.querySelectorAll('.tab').forEach((tabEl) => {
    tabEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.tab-close')) return;
      const dragIndex = Number(tabEl.dataset.tabPos);
      const dragRect = tabEl.getBoundingClientRect();
      const dragMid = dragRect.left + dragRect.width / 2;
      const others = Array.from(tabBar.querySelectorAll('.tab'))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { pos: Number(el.dataset.tabPos), el, mid: rect.left + rect.width / 2 };
        })
        .filter((t) => t.pos !== dragIndex)
        .sort((a, b) => a.mid - b.mid);
      const filteredFrom = others.filter((t) => t.mid < dragMid).length;
      tabDrag = {
        index: dragIndex,
        el: tabEl,
        startX: event.clientX,
        pointerId: event.pointerId,
        moved: false,
        to: filteredFrom,
        others,
        draggedWidth: dragRect.width,
        filteredFrom,
      };
    });
  });
}
function renderState() {
  const state = currentState || { recent: [], tabs: [], active: null, document: null };
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  renderTabs(state);
  if (state.document) {
    document.title = window.leafLocale.t('titles.document', { title: state.document.title });
    app.className = 'reader-shell has-document';
    const minimapHtml = renderDocumentMinimap(state.document.minimap);
    const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';
    app.innerHTML = `<div class="${layoutClass}">${state.document.html}${minimapHtml}</div>`;
    decorateBlockquoteLines();
    decorateAnchorLinks();
    bindDocumentLinks();
    requestDocumentPager(state.document.path || activeDocumentPath());
    bindDocumentMinimap();
    renderMermaidDiagrams();
    renderMathElements();
    decorateCodeBlocks();
    applySpeedReaderToDocument();
    observeReaderReflow();
    scheduleMinimapPreviewUpdate();
    if (resetReaderScrollOnNextRender) {
      resetReaderScrollOnNextRender = false;
      resetReaderScrollToContentStart();
    } else {
      updateMinimapViewport();
    }
    return;
  }
  resetReaderScrollOnNextRender = false;
  document.title = window.leafLocale.t('titles.app');
  app.className = 'reader-shell empty';
  const recent = state.recent || [];
  app.innerHTML = `
    <section class="empty-state">
      <p class="kicker">${escapeText(window.leafLocale.t('empty.kicker'))}</p>
      <h1>${escapeText(window.leafLocale.t('empty.title'))}</h1>
      <p class="empty-description">${escapeText(window.leafLocale.t(emptyDescriptionKey))}</p>
      <button type="button" class="primary-open">${escapeText(window.leafLocale.t('actions.chooseFile'))}</button>
      ${recent.length ? `<div class="recent"><h2>${escapeText(window.leafLocale.t('recent.headingWithCount', { count: window.leafLocale.formatNumber(recent.length) }))}</h2><ol>${recent.map((path) => `<li><button type="button" title="${escapeAttr(window.leafLocale.t('recent.openTitle', { path }))}" data-path="${escapeAttr(path)}" data-reveal-path="${escapeAttr(path)}">${escapeText(path)}</button></li>`).join('')}</ol></div>` : `<p class="empty-help">${escapeText(window.leafLocale.t('empty.noRecent'))}</p>`}
    </section>`;
  app.querySelector('.primary-open').addEventListener('click', () => send({ command: 'open' }));
  app.querySelectorAll('[data-path]').forEach((button) => {
    button.addEventListener('click', () => send({ command: 'openRecent', path: button.dataset.path }));
  });
}
function renderNavigation() {
  backButton.disabled = !navigationState.canGoBack;
  forwardButton.disabled = !navigationState.canGoForward;
}
function sameDocumentFragmentHref(rawHref) {
  if (rawHref.startsWith('#')) {
    return rawHref;
  }
  if (rawHref.startsWith('./#')) {
    return rawHref.slice(2);
  }
  if (rawHref.startsWith('.#')) {
    return rawHref.slice(1);
  }
  return null;
}
// ---- Glossary bottom sheet ------------------------------------------------
// A glossary link (its file basename is GLOSSARY.md and it carries a #anchor)
// opens the term in a sheet over the current document instead of navigating.
// The webview cannot read the file itself, so the click asks the host, which
// reads + renders the glossary and calls window.leafShowGlossary below.
const glossarySheet = document.getElementById('glossarySheet');
const glossaryBackdrop = document.getElementById('glossaryBackdrop');
const glossarySheetBody = document.getElementById('glossarySheetBody');
const glossarySheetClose = document.getElementById('glossarySheetClose');
const glossaryFullLink = document.getElementById('glossaryFullLink');
// The path part of the last glossary link followed from a document, reused so a
// glossary-to-glossary jump resolves against the same file the host opened.
let glossaryHrefBase = 'GLOSSARY.md';
let glossaryLastFocus = null;
function glossaryAnchorFromHref(rawHref) {
  if (!rawHref) return '';
  // Preferred form: a fake `glossary:slug` URL. No file path, so it works at any
  // folder depth. The host finds the nearest GLOSSARY.md when it opens the sheet.
  const scheme = /^glossary:(.*)$/i.exec(rawHref);
  if (scheme) {
    let anchor = scheme[1].replace(/^#/, '');
    try { anchor = decodeURIComponent(anchor); } catch (e) {}
    return anchor;
  }
  if (/^[a-z]+:\/\//i.test(rawHref) || rawHref.startsWith('mailto:')) return '';
  // Real form: a `…/GLOSSARY.md#slug` relative link (what /check expands the
  // shorthand into; also works in plain Markdown viewers). Matched case-insensitively.
  const hashAt = rawHref.indexOf('#');
  if (hashAt < 0) return '';
  const path = rawHref.slice(0, hashAt).split('?')[0];
  const base = path.split(/[\\/]/).pop().toLowerCase();
  if (base !== 'glossary.md') return '';
  let anchor = rawHref.slice(hashAt + 1);
  try { anchor = decodeURIComponent(anchor); } catch (e) {}
  return anchor;
}
function glossaryHeadingLevel(el) {
  const match = /^H([1-6])$/.exec(el.tagName);
  return match ? Number(match[1]) : 0;
}
function extractGlossaryEntry(root, anchor) {
  const start = Array.from(root.querySelectorAll('[id]')).find((el) => el.id === anchor);
  if (!start) return null;
  const level = glossaryHeadingLevel(start) || 6;
  const frag = document.createDocumentFragment();
  frag.appendChild(start.cloneNode(true));
  let node = start.nextElementSibling;
  while (node) {
    const lvl = glossaryHeadingLevel(node);
    if (lvl && lvl <= level) break;
    frag.appendChild(node.cloneNode(true));
    node = node.nextElementSibling;
  }
  return frag;
}
function onGlossaryKey(event) {
  if (event.key === 'Escape') dismissGlossary();
}
function showGlossary() {
  glossaryLastFocus = document.activeElement;
  glossaryBackdrop.hidden = false;
  glossarySheet.hidden = false;
  requestAnimationFrame(() => {
    glossaryBackdrop.classList.add('open');
    glossarySheet.classList.add('open');
  });
  document.addEventListener('keydown', onGlossaryKey);
  glossarySheetClose.focus();
}
function dismissGlossary() {
  if (glossarySheet.hidden) return;
  glossaryBackdrop.classList.remove('open');
  glossarySheet.classList.remove('open');
  document.removeEventListener('keydown', onGlossaryKey);
  const hide = () => {
    glossarySheet.hidden = true;
    glossaryBackdrop.hidden = true;
    glossarySheet.removeEventListener('transitionend', hide);
  };
  glossarySheet.addEventListener('transitionend', hide);
  setTimeout(hide, 320);
  if (glossaryLastFocus && glossaryLastFocus.focus) glossaryLastFocus.focus();
}
glossaryBackdrop.addEventListener('click', dismissGlossary);
glossarySheetClose.addEventListener('click', dismissGlossary);
// "Open the full glossary" opens the glossary file as an ordinary document tab,
// resolved (like the link that opened the sheet) against the active document.
glossaryFullLink.addEventListener('click', (event) => {
  event.preventDefault();
  dismissGlossary();
  send({ command: 'openLink', href: glossaryHrefBase, scroll_anchor: currentScrollAnchor() });
});
glossarySheetBody.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  const rawHref = link.getAttribute('href') || '';
  if (!rawHref || /^[a-z]+:\/\//i.test(rawHref) || rawHref.startsWith('mailto:')) return;
  event.preventDefault();
  const within = glossaryAnchorFromHref(rawHref) || (rawHref.startsWith('#') ? rawHref.slice(1) : '');
  if (within) {
    send({ command: 'openGlossary', href: glossaryHrefBase + '#' + within });
    return;
  }
  dismissGlossary();
  send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });
});
const linkHoverTip = document.createElement('div');
linkHoverTip.className = 'link-hover-tip';
linkHoverTip.hidden = true;
linkHoverTip.innerHTML =
  '<div class="link-hover-tip-kind"></div>' +
  '<div class="link-hover-tip-detail"></div>';
document.body.appendChild(linkHoverTip);
const linkHoverTipKind = linkHoverTip.querySelector('.link-hover-tip-kind');
const linkHoverTipDetail = linkHoverTip.querySelector('.link-hover-tip-detail');
const canHoverLinks = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
let activeHoverLink = null;
function hideLinkHoverTip() {
  activeHoverLink = null;
  linkHoverTip.hidden = true;
}
function positionLinkHoverTip(event) {
  const margin = 14;
  const rect = linkHoverTip.getBoundingClientRect();
  let left = event.clientX + 18;
  let top = event.clientY + 18;
  if (left + rect.width > window.innerWidth - margin) {
    left = Math.max(margin, event.clientX - rect.width - 18);
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = Math.max(margin, event.clientY - rect.height - 18);
  }
  linkHoverTip.style.left = left + 'px';
  linkHoverTip.style.top = top + 'px';
}
function linkHoverInfo(rawHref) {
  if (!rawHref) return null;
  if (/^glossary:\s*$/i.test(rawHref)) {
    return { kind: 'Full glossary', detail: rawHref };
  }
  if (glossaryAnchorFromHref(rawHref)) {
    return { kind: 'Glossary entry', detail: rawHref };
  }
  if (sameDocumentFragmentHref(rawHref)) {
    return { kind: 'In-page jump', detail: rawHref };
  }
  if (/^mailto:/i.test(rawHref)) {
    return { kind: 'Email link', detail: rawHref };
  }
  if (/^https?:\/\//i.test(rawHref)) {
    return { kind: 'External site', detail: rawHref };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) {
    return { kind: 'App link', detail: rawHref };
  }
  if (/\.md(?:[#?].*)?$/i.test(rawHref)) {
    return { kind: 'Another page', detail: rawHref };
  }
  if (rawHref.startsWith('/')) {
    return { kind: 'Local path', detail: rawHref };
  }
  return { kind: 'Link', detail: rawHref };
}
if (canHoverLinks) {
  document.addEventListener('pointerover', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const rawHref = (link.getAttribute('href') || '').trim();
    const info = linkHoverInfo(rawHref);
    if (!info) {
      hideLinkHoverTip();
      return;
    }
    activeHoverLink = link;
    linkHoverTipKind.textContent = info.kind;
    linkHoverTipDetail.textContent = info.detail;
    linkHoverTip.hidden = false;
    positionLinkHoverTip(event);
  });
  document.addEventListener('pointermove', (event) => {
    if (!activeHoverLink) return;
    positionLinkHoverTip(event);
  });
  document.addEventListener('pointerout', (event) => {
    if (!activeHoverLink) return;
    const next = event.relatedTarget;
    if (next && next.closest && next.closest('a[href]') === activeHoverLink) return;
    hideLinkHoverTip();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideLinkHoverTip();
  });
  window.addEventListener('blur', hideLinkHoverTip);
  app.addEventListener('scroll', hideLinkHoverTip, true);
}
// Called by the host with the fully rendered glossary document; pull out the
// requested entry and slide the sheet up.
window.leafShowGlossary = (html, anchor) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  const entry = extractGlossaryEntry(root, anchor);
  glossarySheetBody.innerHTML = '';
  if (entry) {
    glossarySheetBody.appendChild(entry);
  } else {
    glossarySheetBody.textContent = 'No glossary entry for “' + anchor + '”.';
  }
  glossarySheetBody.scrollTop = 0;
  showGlossary();
};
function bindDocumentLinks() {
  app.querySelectorAll('.document-body a[href]').forEach((link) => {
    if (link.dataset.leafLinkBound === 'true') return;
    link.dataset.leafLinkBound = 'true';
    link.removeAttribute('target');
    link.rel = 'noreferrer noopener';
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const rawHref = link.getAttribute('href') || '';
      if (!rawHref) {
        return;
      }
      const glossaryTerm = glossaryAnchorFromHref(rawHref);
      if (glossaryTerm) {
        event.preventDefault();
        // For a `glossary:` link keep the bare scheme as the base, so a jump to
        // another term (glossaryHrefBase + '#' + term) and "open full glossary"
        // both stay on the scheme and let the host re-resolve the nearest file.
        glossaryHrefBase = /^glossary:/i.test(rawHref) ? 'glossary:' : rawHref.split('#')[0];
        send({ command: 'openGlossary', href: rawHref });
        return;
      }
      const fragmentHref = sameDocumentFragmentHref(rawHref);
      if (fragmentHref) {
        event.preventDefault();
        send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });
        return;
      }
      event.preventDefault();
      send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });
    });
  });
}
function loadMermaid() {
  if (window.mermaid) {
    return Promise.resolve(window.mermaid);
  }
  if (mermaidLoadPromise) {
    return mermaidLoadPromise;
  }
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MERMAID_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }
      reject(new Error('Mermaid runtime loaded without exposing window.mermaid'));
    };
    script.onerror = () => reject(new Error('Mermaid runtime failed to load'));
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}
function renderMermaidDiagrams() {
  const diagrams = Array.from(app.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"])'));
  if (!diagrams.length) {
    return;
  }
  loadMermaid()
    .then((mermaid) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
        fontFamily: "'Noto Sans', sans-serif",
        themeVariables: { fontFamily: "'Noto Sans', sans-serif" },
      });
      return mermaid.run({ nodes: diagrams });
    })
    .catch((error) => {
      console.error(error);
      diagrams.forEach((diagram) => {
        diagram.dataset.mermaidRender = 'failed';
      });
    });
}
// KaTeX (bundled, loaded lazily) renders the .math elements pulldown-cmark emits
// for $…$ and $$…$$. The raw TeX is the element's text; KaTeX replaces it in
// place, falling back to that readable text if the runtime can't load.
function loadKatex() {
  if (window.katex) {
    return Promise.resolve(window.katex);
  }
  if (katexLoadPromise) {
    return katexLoadPromise;
  }
  katexLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = KATEX_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.katex) {
        resolve(window.katex);
        return;
      }
      reject(new Error('KaTeX runtime loaded without exposing window.katex'));
    };
    script.onerror = () => reject(new Error('KaTeX runtime failed to load'));
    document.head.appendChild(script);
  });
  return katexLoadPromise;
}
function renderMathElements() {
  const nodes = Array.from(app.querySelectorAll('.math:not([data-math-rendered])'));
  if (!nodes.length) {
    return;
  }
  loadKatex()
    .then((katex) => {
      nodes.forEach((node) => {
        try {
          katex.render(node.textContent, node, {
            displayMode: node.classList.contains('math-display'),
            throwOnError: false,
          });
        } catch (error) {
          console.error(error);
        }
        node.dataset.mathRendered = 'true';
      });
    })
    .catch((error) => {
      console.error(error);
    });
}
function decorateBlockquoteLines(root = app) {
  root.querySelectorAll('blockquote:not(.markdown-alert) p').forEach((paragraph) => {
    if (paragraph.querySelector('.blockquote-line')) return;
    const children = Array.from(paragraph.childNodes);
    if (!children.some((node) => node.nodeName === 'BR')) return;
    const fragment = document.createDocumentFragment();
    let line = document.createElement('span');
    line.className = 'blockquote-line';
    children.forEach((node) => {
      if (node.nodeName === 'BR') {
        fragment.appendChild(line);
        line = document.createElement('span');
        line.className = 'blockquote-line';
        return;
      }
      line.appendChild(node);
    });
    fragment.appendChild(line);
    paragraph.replaceChildren(fragment);
    paragraph.classList.add('blockquote-lines');
  });
}
// Copy ("document duplicate") and check marks, sized by CSS. The button holds
// both and the .is-copied class swaps which one shows.
const CODE_COPY_ICON = '<svg class="code-copy-mark code-copy-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"/></svg><svg class="code-copy-mark code-copy-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';
// Give every fenced/indented code block (but not Mermaid diagrams) a "copy all"
// button. Done here in JS, after the sanitized HTML is in the DOM, so the markup
// the sanitizer sees stays just <pre><code>. The button copies the code verbatim.
function decorateCodeBlocks() {
  app.querySelectorAll('.document-body pre:not(.mermaid)').forEach((pre) => {
    if (pre.querySelector(':scope > .code-copy')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.innerHTML = CODE_COPY_ICON;
    setCodeCopyLabel(button, 'actions.copyCode');
    button.addEventListener('click', () => copyCodeBlock(button, code.textContent || ''));
    pre.appendChild(button);
  });
}
// Heroicon "link", drawn the same way as the copy mark (no fill, currentColor
// stroke) so it inherits theme colors. Sized by CSS.
const ANCHOR_LINK_ICON = '<svg class="heading-anchor-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"/></svg>';
// `pre:not(.mermaid)` excludes Mermaid diagrams: a permalink gutter link makes
// no sense on a diagram, and inserting one as the pre's first child corrupts the
// source Mermaid reads from innerHTML, yielding a "Syntax error" bomb.
const ANCHOR_LINK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre:not(.mermaid), table, details, figure, div[id], a[id]';
function uniqueAnchorBlockId(seen, base) {
  let candidate = base;
  let suffix = 1;
  while (!candidate || seen.has(candidate)) {
    candidate = base + '-' + suffix;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}
// A list item that is purely a link (or links) is a table-of-contents /
// navigation entry, not body content, so it takes no verse number.
function isNavOutlineItem(el) {
  if (el.tagName !== 'LI') return false;
  const text = (el.textContent || '').replace(/\s+/g, '');
  if (!text) return false;
  let linkText = '';
  el.querySelectorAll('a').forEach((a) => {
    linkText += a.textContent || '';
  });
  return text === linkText.replace(/\s+/g, '');
}
// Give `target` the address `locus`: if it already has an id (a heading slug or
// an author anchor) keep that id and add a hidden alias carrying the locus, so
// #<locus> still lands on it; otherwise the locus becomes the id. Either way the
// locus is recorded on dataset.locus for the gutter permalink.
function assignLocus(target, locus, seen) {
  if (target.id) {
    seen.add(target.id);
    const alias = document.createElement('span');
    alias.className = 'locus-alias';
    alias.id = uniqueAnchorBlockId(seen, locus);
    alias.setAttribute('aria-hidden', 'true');
    target.insertBefore(alias, target.firstChild);
    target.dataset.locus = alias.id;
  } else {
    target.id = uniqueAnchorBlockId(seen, locus);
    target.dataset.locus = target.id;
  }
}
// Number the document so each block has a citable address. Each top-level
// heading (h1) opens a chapter. Headings (h1–h6) are addressed h<chapter>.<n> —
// the leading "h" marks them as headings, distinct from body blocks — where n
// runs 1, 2, 3 … through the headings in that chapter and resets at the next h1.
// Every body block after a heading — paragraphs, quotes, content list items,
// tables — is the next running verse in that chapter: chapter.verse with a dot
// (1.1, 1.2, 1.3 …); the verse counter runs straight through sub-headings and
// resets only at the next chapter. A heading keeps the slug id the renderer gave
// it (so the TOC and #slug links resolve) and carries its number through a
// hidden alias. The navigation outline (a list of link-only items) is skipped.
// Numbering is deterministic, so the ids survive the document re-render a
// fragment jump triggers.
function ensureAnchorLinkTargets(body) {
  const seen = new Set(Array.from(body.querySelectorAll('[id]')).map((element) => element.id).filter(Boolean));
  let chapter = 0;
  let verse = 0;
  let headingNum = 0;
  body.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    if (target.classList.contains('footnote-definition')) return;
    if (isNavOutlineItem(target)) return;
    const tag = target.tagName;
    if (tag === 'H1') {
      chapter += 1;
      verse = 0;
      headingNum = 1;
      assignLocus(target, 'h' + chapter + '.' + headingNum, seen);
    } else if (/^H[2-6]$/.test(tag)) {
      if (chapter === 0) chapter = 1;
      headingNum += 1;
      assignLocus(target, 'h' + chapter + '.' + headingNum, seen);
    } else {
      if (chapter === 0) chapter = 1;
      verse += 1;
      assignLocus(target, chapter + '.' + verse, seen);
    }
  });
}
// Give every anchor-addressable block a permalink button in the left gutter,
// GitHub style. Done in JS, after sanitized HTML is in the DOM, so it catches
// raw-HTML blocks uniformly without parsing strings in Rust. The button is a
// real anchor link to the target id, so bindDocumentLinks (run right after this)
// wires it into the same in-document fragment navigation as a TOC link. Clicking
// it also copies that #locus to the clipboard (without blocking the jump) so the
// canonical number can be pasted out — the only way to read the locus on touch,
// where there is no hover tooltip to reveal it.
function decorateAnchorLinks() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  ensureAnchorLinkTargets(body);
  const label = window.leafLocale.t('actions.anchorLink');
  body.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    const locus = target.dataset.locus;
    if (!locus) return;
    if (target.classList.contains('footnote-definition')) return;
    if (target.querySelector(':scope > .heading-anchor')) return;
    const link = document.createElement('a');
    link.className = 'heading-anchor';
    link.href = '#' + encodeURIComponent(locus);
    link.setAttribute('aria-label', label);
    link.title = label;
    link.innerHTML = ANCHOR_LINK_ICON;
    link.addEventListener('click', () => {
      copyToClipboard('#' + locus);
      link.classList.add('is-copied');
      window.clearTimeout(link.__copiedTimer);
      link.__copiedTimer = window.setTimeout(() => link.classList.remove('is-copied'), 900);
    });
    target.classList.add('has-anchor-link');
    target.insertBefore(link, target.firstChild);
  });
  positionAnchorLinks(body);
}
// Park every permalink button in the document's left margin, lined up with where
// a top-level heading's button sits, no matter how deeply its block is indented.
// The button's right edge already meets its block's left edge (right: 100% in
// CSS); here we shift it further left by the block's own indentation so it clears
// the indented text instead of overlapping it. The indent can't be derived in
// pure CSS — accumulating it through a custom property forms a self-referential
// cycle that the engine discards — so we measure each block's left edge against
// the body's and shift by the difference. Measuring also handles every list,
// blockquote, padding, and text-indent combination exactly. Re-run on reflow and
// resize (see scheduleReaderLayoutUpdate) because the indent is em-based and
// scales with the viewport-driven font size. Reads are batched ahead of writes to
// avoid layout thrash; the buttons are out of flow, so moving them never resizes
// the body and so never loops the reflow observer.
function positionAnchorLinks(body) {
  body = body || app.querySelector('.document-body');
  if (!body) return;
  const blocks = body.querySelectorAll('.has-anchor-link');
  if (!blocks.length) return;
  const bodyLeft = body.getBoundingClientRect().left;
  const indents = [];
  blocks.forEach((block) => {
    indents.push(block.getBoundingClientRect().left - bodyLeft);
  });
  blocks.forEach((block, index) => {
    const link = block.querySelector(':scope > .heading-anchor');
    if (!link) return;
    const indent = indents[index];
    link.style.right = indent > 0.5 ? `calc(100% + ${Math.round(indent)}px)` : '';
  });
}
function setCodeCopyLabel(button, key) {
  const label = window.leafLocale.t(key);
  button.setAttribute('aria-label', label);
  button.title = label;
}
// Copy via the async clipboard API, falling back to a hidden textarea +
// execCommand for webview contexts where the async API is blocked.
function copyCodeBlock(button, text) {
  const ok = () => flashCodeCopied(button);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => { if (legacyCopy(text)) ok(); });
  } else if (legacyCopy(text)) {
    ok();
  }
}
function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}
// Copy arbitrary text, preferring the async clipboard API and falling back to the
// hidden-textarea path for webview contexts where it is blocked. Used by the
// gutter permalink so a tapped locus number can be pasted out.
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => { legacyCopy(text); });
    return;
  }
  legacyCopy(text);
}
// Briefly show the check mark and a "Copied" label, then revert.
function flashCodeCopied(button) {
  button.classList.add('is-copied');
  setCodeCopyLabel(button, 'actions.copiedCode');
  window.clearTimeout(button.__copiedTimer);
  button.__copiedTimer = window.setTimeout(() => {
    button.classList.remove('is-copied');
    setCodeCopyLabel(button, 'actions.copyCode');
  }, 1400);
}
function renderDocumentMinimap(model) {
  if (!window.leafMinimap.getEnabled()) {
    return '';
  }
  if (!model || !Number.isFinite(model.line_count) || model.line_count <= 0) {
    return '';
  }
  return `<aside class="document-minimap" aria-label="${escapeAttr(window.leafLocale.t('minimap.aria'))}"><div class="document-minimap-track" aria-hidden="true"><div class="document-minimap-content" aria-hidden="true"></div><div class="document-minimap-viewport" aria-hidden="true"></div></div></aside>`;
}
function bindDocumentMinimap() {
  const minimap = app.querySelector('.document-minimap');
  const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
  if (!track) {
    return;
  }
  const restoreFocus = () => {
    const active = document.activeElement;
    return () => {
      if (active && typeof active.focus === 'function' && document.contains(active)) {
        active.focus({ preventScroll: true });
      }
    };
  };
  const minimapPointerOffset = (event) => {
    const viewport = track.querySelector('.document-minimap-viewport');
    const viewportRect = viewport ? viewport.getBoundingClientRect() : null;
    if (!viewportRect || event.clientY < viewportRect.top || event.clientY > viewportRect.bottom) {
      return null;
    }
    return event.clientY - viewportRect.top;
  };
  const dragMinimapViewportToPointer = (event, pointerOffsetY) => {
    const metrics = measureDocumentMinimap(track);
    const rect = metrics.trackRect;
    if (rect.height <= 0 || metrics.scrollable <= 0) {
      updateMinimapViewport();
      return;
    }
    const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, metrics);
    const scaledDocumentHeight = Math.max(1, metrics.scrollHeight * previewScale);
    const viewportHeight = metrics.scrollHeight <= 0 ? metrics.trackHeight : Math.max(22, metrics.viewportHeight * previewScale);
    const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);
    const handleRange = Math.max(0, metrics.trackHeight - boundedViewportHeight);
    const offsetY = Number.isFinite(pointerOffsetY) ? pointerOffsetY : boundedViewportHeight / 2;
    const targetViewportTop = Math.min(handleRange, Math.max(0, event.clientY - rect.top - offsetY));
    const previewTravel = Math.max(0, scaledDocumentHeight - metrics.trackHeight);
    const viewportTopPerScrollPixel = previewScale - previewTravel / metrics.scrollable;
    const targetViewportScrollTop = viewportTopPerScrollPixel > 0
      ? targetViewportTop / viewportTopPerScrollPixel
      : (handleRange <= 0 ? 0 : (targetViewportTop / handleRange) * metrics.scrollable);
    setReaderScrollTop(metrics.topOffset + Math.min(metrics.scrollable, Math.max(0, targetViewportScrollTop)));
    updateMinimapViewport();
  };
  const scrollToMinimapSnapshotPoint = (event) => {
    const metrics = measureDocumentMinimap(track);
    const content = track.querySelector('.document-minimap-content');
    const contentRect = content ? content.getBoundingClientRect() : null;
    if (!contentRect || contentRect.height <= 0 || metrics.scrollHeight <= 0 || metrics.scrollable <= 0) {
      updateMinimapViewport();
      return;
    }
    const previewScale = minimapPreviewScale(track, metrics);
    if (!Number.isFinite(previewScale) || previewScale <= 0) {
      updateMinimapViewport();
      return;
    }
    const clickedDocumentY = (event.clientY - contentRect.top) / previewScale;
    const targetViewportScrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));
    setReaderScrollTop(metrics.topOffset + targetViewportScrollTop);
    updateMinimapViewport();
  };
  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const focusAfterJump = restoreFocus();
    event.preventDefault();
    minimapPointerId = event.pointerId;
    minimapPointerOffsetY = minimapPointerOffset(event);
    track.setPointerCapture(event.pointerId);
    if (Number.isFinite(minimapPointerOffsetY)) {
      dragMinimapViewportToPointer(event, minimapPointerOffsetY);
    } else {
      scrollToMinimapSnapshotPoint(event);
    }
    focusAfterJump();
  });
  track.addEventListener('pointermove', (event) => {
    if (event.pointerId !== minimapPointerId) {
      return;
    }
    event.preventDefault();
    dragMinimapViewportToPointer(event, minimapPointerOffsetY);
  });
  const endDrag = (event) => {
    if (event.pointerId === minimapPointerId) {
      minimapPointerId = null;
      minimapPointerOffsetY = null;
    }
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('lostpointercapture', endDrag);
  bindDocumentMinimapPreview(track);
}
function bindDocumentMinimapPreview(track) {
  disconnectMinimapPreviewObservers();
  const source = app.querySelector('.document-body');
  if (!source) {
    return;
  }
  minimapBodyObserver = new MutationObserver(scheduleMinimapPreviewUpdate);
  minimapBodyObserver.observe(source, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  if (window.ResizeObserver) {
    minimapResizeObserver = new ResizeObserver(() => {
      scheduleReaderLayoutUpdate();
      scheduleMinimapPreviewUpdate();
    });
    minimapResizeObserver.observe(source);
    minimapResizeObserver.observe(track);
  }
  scheduleMinimapPreviewUpdate();
}
function disconnectMinimapPreviewObservers() {
  if (minimapBodyObserver) {
    minimapBodyObserver.disconnect();
    minimapBodyObserver = null;
  }
  if (minimapResizeObserver) {
    minimapResizeObserver.disconnect();
    minimapResizeObserver = null;
  }
}
function measureDocumentContent(source) {
  if (!source) {
    return { rawTopOffset: 0, topOffset: 0, height: 1 };
  }
  const shellRect = app.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const firstContent = source.firstElementChild;
  const firstContentRect = firstContent ? firstContent.getBoundingClientRect() : sourceRect;
  const rawTopOffset = Math.ceil(app.scrollTop + firstContentRect.top - shellRect.top);
  const topOffset = Math.max(0, rawTopOffset - READER_CONTENT_TOP_GAP);
  const sourceTop = Math.max(0, app.scrollTop + sourceRect.top - shellRect.top);
  const sourceBottom = sourceTop + Math.max(source.scrollHeight, sourceRect.height);
  const height = Math.max(1, Math.ceil(sourceBottom - topOffset));
  return { rawTopOffset, topOffset, height };
}
function readerScrollOrigin(source) {
  if (!source) {
    return 0;
  }
  const value = Number.parseFloat(source.style.getPropertyValue('--reader-scroll-origin'));
  return Number.isFinite(value) ? value : 0;
}
function correctReaderScrollOrigin(source = app.querySelector('.document-body')) {
  if (!currentState?.document || !source) {
    return { rawTopOffset: 0, topOffset: 0, height: 1 };
  }
  const content = measureDocumentContent(source);
  const origin = readerScrollOrigin(source);
  const nextOrigin = Math.max(0, Math.ceil(content.rawTopOffset + origin - READER_CONTENT_TOP_GAP));
  if (Math.abs(nextOrigin - origin) >= 0.5) {
    source.style.setProperty('--reader-scroll-origin', `${nextOrigin}px`);
  }
  return measureDocumentContent(source);
}
function measureReaderScrollRange(documentContent, viewportHeight) {
  const scrollHeight = Math.max(documentContent.height, Math.ceil(app.scrollHeight - documentContent.topOffset));
  const scrollable = Math.max(0, scrollHeight - viewportHeight);
  return {
    scrollHeight,
    scrollable,
    minScrollTop: documentContent.topOffset,
    maxScrollTop: documentContent.topOffset + scrollable,
  };
}
function clampReaderScrollTop(scrollTop) {
  const nextScrollTop = Number(scrollTop);
  if (!Number.isFinite(nextScrollTop)) {
    return 0;
  }
  const source = app.querySelector('.document-body');
  if (!currentState?.document || !source) {
    return Math.max(0, nextScrollTop);
  }
  const content = correctReaderScrollOrigin(source);
  const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));
  const range = measureReaderScrollRange(content, viewportHeight);
  return Math.min(range.maxScrollTop, Math.max(range.minScrollTop, nextScrollTop));
}
function setReaderScrollTop(scrollTop) {
  app.scrollTop = clampReaderScrollTop(scrollTop);
}
function clampReaderScrollPosition() {
  if (!currentState?.document) {
    return false;
  }
  const clampedScrollTop = clampReaderScrollTop(app.scrollTop);
  if (Math.abs(clampedScrollTop - app.scrollTop) < 0.5) {
    return false;
  }
  app.scrollTop = clampedScrollTop;
  return true;
}
function resetReaderScrollToContentStart() {
  window.requestAnimationFrame(() => {
    const source = app.querySelector('.document-body');
    const content = correctReaderScrollOrigin(source);
    setReaderScrollTop(content.topOffset);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
}
// Describe the reader's current position as a serializable, render-independent
// anchor: the nearest heading slug above the top edge, the ordinal of the block
// within that section (the heading itself is block 0), and the signed pixel
// offset of the top edge from that block's top. The offset is signed so it
// preserves the reading-mode top gap at the start of a document (where the edge
// sits above the first block). Measuring the ordinal from the section, not the
// document start, keeps the landing stable when content is added to earlier
// sections (e.g. live reload after an edit).
function captureReaderScrollAnchor() {
  const source = app.querySelector('.document-body');
  if (!currentState?.document || !source) {
    return null;
  }
  const blocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));
  if (!blocks.length) {
    return null;
  }
  const shellRect = app.getBoundingClientRect();
  let targetIndex = blocks.findIndex((element) => element.getBoundingClientRect().bottom > shellRect.top + 1);
  if (targetIndex < 0) {
    targetIndex = blocks.length - 1;
  }
  let sectionIndex = -1;
  let section = null;
  for (let i = targetIndex; i >= 0; i--) {
    const element = blocks[i];
    if (/^H[1-6]$/.test(element.tagName) && element.id) {
      section = element.id;
      sectionIndex = i;
      break;
    }
  }
  const target = blocks[targetIndex];
  const rect = target.getBoundingClientRect();
  const offsetY = shellRect.top - rect.top;
  return { section, block: targetIndex - (sectionIndex < 0 ? 0 : sectionIndex), offsetY };
}
// Re-resolve a serializable anchor against the current DOM. The same Markdown
// renders the same blocks, so the section heading and block ordinal point back
// at the original element even after a full re-render.
function resolveReaderAnchorElement(anchor) {
  const source = app.querySelector('.document-body');
  if (!source || !anchor) {
    return null;
  }
  const blocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));
  if (!blocks.length) {
    return null;
  }
  let start = 0;
  if (anchor.section) {
    const index = blocks.findIndex((element) => element.id === anchor.section && /^H[1-6]$/.test(element.tagName));
    if (index >= 0) {
      start = index;
    }
  }
  const block = Math.max(0, Math.floor(Number(anchor.block) || 0));
  return blocks[Math.min(start + block, blocks.length - 1)] || blocks[blocks.length - 1];
}
function restoreReaderScrollAnchor(anchor) {
  const element = resolveReaderAnchorElement(anchor);
  if (!element || !element.isConnected) {
    clampReaderScrollPosition();
    return;
  }
  const shellRect = app.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const offsetY = Number.isFinite(anchor?.offsetY) ? anchor.offsetY : 0;
  setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);
}
function scheduleReaderLayoutUpdate(anchor = readerScrollAnchor || captureReaderScrollAnchor()) {
  if (readerLayoutFrame) {
    return;
  }
  readerLayoutFrame = window.requestAnimationFrame(() => {
    readerLayoutFrame = 0;
    correctReaderScrollOrigin();
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
    positionAnchorLinks();
  });
}
function disconnectReaderReflowObserver() {
  if (readerReflowObserver) {
    readerReflowObserver.disconnect();
    readerReflowObserver = null;
  }
}
// Keep the reader pinned to its anchor as the document settles. Images decode a
// few frames after a re-render and grow the content above the reader; without
// this the saved anchor would be restored once into a still-collapsing layout
// and then drift downward as the images land. Re-pinning on every reflow — and
// on each image load — holds the reader on the same block until layout is final.
function observeReaderReflow() {
  disconnectReaderReflowObserver();
  const source = app.querySelector('.document-body');
  if (!source) {
    return;
  }
  if (typeof ResizeObserver !== 'undefined') {
    readerReflowObserver = new ResizeObserver(() => scheduleReaderLayoutUpdate());
    readerReflowObserver.observe(source);
  }
  source.querySelectorAll('img').forEach((image) => {
    if (image.complete) {
      return;
    }
    image.addEventListener('load', () => scheduleReaderLayoutUpdate(), { once: true });
    image.addEventListener('error', () => scheduleReaderLayoutUpdate(), { once: true });
  });
}
function syncMinimapTrackHeight(minimap) {
  const shellRect = app.getBoundingClientRect();
  const minimapRect = minimap.getBoundingClientRect();
  const availableHeight = Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));
  const content = minimap.querySelector('.document-minimap-content');
  const contentRect = content ? content.getBoundingClientRect() : null;
  const contentHeight = contentRect ? Math.ceil(contentRect.height) : 0;
  const trackHeight = contentHeight > 0 ? Math.min(availableHeight, contentHeight) : availableHeight;
  minimap.style.setProperty('--minimap-track-height', `${trackHeight}px`);
  return { availableHeight, trackHeight };
}
function measureDocumentMinimap(track) {
  const minimap = track.closest('.document-minimap');
  const source = app.querySelector('.document-body');
  const trackSize = minimap ? syncMinimapTrackHeight(minimap) : null;
  const shellHeight = trackSize ? trackSize.availableHeight : Math.max(1, app.clientHeight);
  const sourceRect = source ? source.getBoundingClientRect() : null;
  const sourceWidth = sourceRect ? Math.max(1, Math.ceil(sourceRect.width)) : 1;
  const documentContent = correctReaderScrollOrigin(source);
  const documentHeight = documentContent.height;
  const trackRect = track.getBoundingClientRect();
  const trackHeight = Math.max(1, Math.ceil(track.clientHeight || trackRect.height || trackSize?.trackHeight || shellHeight));
  const viewportHeight = Math.max(1, Math.ceil(app.clientHeight || shellHeight));
  const scrollRange = measureReaderScrollRange(documentContent, viewportHeight);
  const scrollHeight = scrollRange.scrollHeight;
  const scrollable = scrollRange.scrollable;
  const viewportScrollTop = Math.min(scrollable, Math.max(0, app.scrollTop - documentContent.topOffset));
  return { source, sourceWidth, documentHeight, topOffset: documentContent.topOffset, trackRect, trackHeight, viewportHeight, scrollHeight, scrollable, viewportScrollTop };
}
function minimapPreviewScale(track, metrics) {
  const content = track.querySelector('.document-minimap-content');
  const contentWidth = content ? Math.max(1, content.getBoundingClientRect().width) : metrics.sourceWidth;
  return contentWidth / Math.max(1, metrics.sourceWidth);
}
function scheduleMinimapPreviewUpdate() {
  if (minimapPreviewFrame) {
    return;
  }
  minimapPreviewFrame = window.requestAnimationFrame(() => {
    minimapPreviewFrame = 0;
    updateDocumentMinimapPreview();
  });
}
function updateDocumentMinimapPreview() {
  const minimap = app.querySelector('.document-minimap');
  const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
  const content = track ? track.querySelector('.document-minimap-content') : null;
  const source = app.querySelector('.document-body');
  if (!track || !content || !source) {
    return;
  }
  const metrics = measureDocumentMinimap(track);
  const contentRect = content.getBoundingClientRect();
  const previewWidth = Math.max(1, Math.ceil(contentRect.width));
  const previewScale = previewWidth / metrics.sourceWidth;
  const scaledHeight = Math.max(1, metrics.scrollHeight * previewScale);
  const preview = source.cloneNode(true);
  preview.removeAttribute('id');
  preview.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  preview.querySelectorAll('a[href]').forEach((link) => link.removeAttribute('href'));
  preview.classList.add('document-minimap-preview');
  preview.setAttribute('aria-hidden', 'true');
  preview.style.width = `${metrics.sourceWidth}px`;
  preview.style.minHeight = `${metrics.scrollHeight}px`;
  preview.style.transform = `scale(${previewScale})`;
  content.style.height = `${scaledHeight}px`;
  content.replaceChildren(preview);
  updateMinimapViewport();
}
function scheduleMinimapViewportUpdate() {
  if (minimapViewportFrame) {
    return;
  }
  minimapViewportFrame = window.requestAnimationFrame(() => {
    minimapViewportFrame = 0;
    updateMinimapViewport();
  });
}
function updateMinimapViewport() {
  const minimap = app.querySelector('.document-minimap');
  if (!minimap) {
    return;
  }
  const track = minimap.querySelector('.document-minimap-track');
  const content = minimap.querySelector('.document-minimap-content');
  if (!track) {
    return;
  }
  const metrics = measureDocumentMinimap(track);
  const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, metrics);
  const scaledDocumentHeight = Math.max(1, metrics.scrollHeight * previewScale);
  if (content) {
    content.style.height = `${scaledDocumentHeight}px`;
  }
  const scrollRatio = metrics.scrollable === 0 ? 0 : Math.min(1, Math.max(0, metrics.viewportScrollTop / metrics.scrollable));
  const viewportHeight = metrics.scrollHeight <= 0 ? metrics.trackHeight : Math.max(22, metrics.viewportHeight * previewScale);
  const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);
  const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);
  const viewportDocumentTop = metrics.viewportScrollTop * previewScale;
  const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));
  minimap.style.setProperty('--minimap-viewport-top', `${viewportTop}px`);
  minimap.style.setProperty('--minimap-viewport-height', `${boundedViewportHeight}px`);
  minimap.style.setProperty('--minimap-preview-top', `${previewTop}px`);
}
app.addEventListener('scroll', () => {
  clampReaderScrollPosition();
  readerScrollAnchor = captureReaderScrollAnchor();
  scheduleMinimapViewportUpdate();
});
window.addEventListener('resize', () => {
  scheduleReaderLayoutUpdate();
  scheduleMinimapViewportUpdate();
  scheduleMinimapPreviewUpdate();
});
window.leafShowError = (message) => {
  const existing = document.querySelector('.app-error');
  if (existing) {
    existing.remove();
  }
  const error = document.createElement('div');
  error.className = 'app-error';
  error.setAttribute('role', 'status');
  error.textContent = message;
  document.body.appendChild(error);
  setTimeout(() => error.remove(), 7000);
};
window.leafShowOpenError = (path, reason) => {
  window.leafShowError(window.leafLocale.t('errors.openFailed', { path, reason }));
};
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function escapeAttr(value) {
  return escapeText(value).replace(/`/g, '&#96;');
}
window.leafSetState(window.__leafInitialState || { recent: [], document: null });
window.leafSetNavigation({ canGoBack: false, canGoForward: false });
</script>
</body>
</html>"#
    .replace("{{THEME_BOOTSTRAP_SCRIPT}}", theme_bootstrap_script())
    .replace("{{LOCALE_BOOTSTRAP_SCRIPT}}", locale_bootstrap_script())
    .replace("{{READING_MODE_CSS}}", reading_mode_css())
    .replace("{{MERMAID_SCRIPT_URL}}", &bundled_asset_url("mermaid.min.js"))
    .replace("{{KATEX_SCRIPT_URL}}", &bundled_asset_url("katex/katex.min.js"))
    .replace("{{KATEX_CSS_URL}}", &bundled_asset_url("katex/katex.min.css"))
    .replace("{{BRAND_LOGO}}", BRAND_LOGO_DATA_URI.trim())
    .replace(
        "{{BACK_ICON_SVG}}",
        normalize_svg_icon_colors(BACK_ICON_SVG).trim(),
    )
    .replace(
        "{{FORWARD_ICON_SVG}}",
        normalize_svg_icon_colors(FORWARD_ICON_SVG).trim(),
    )
    .replace(
        "{{SETTINGS_ICON_SVG}}",
        normalize_svg_icon_colors(SETTINGS_ICON_SVG).trim(),
    )
    .replace(
        "{{OPEN_LIBRARY_ICON_SVG}}",
        normalize_svg_icon_colors(OPEN_LIBRARY_ICON_SVG).trim(),
    )
    .replace(
        "{{OPEN_ICON_SVG}}",
        normalize_svg_icon_colors(OPEN_ICON_SVG).trim(),
    )
}

fn normalize_svg_icon_colors(svg: &str) -> String {
    let mut normalized = String::with_capacity(svg.len());
    let mut index = 0;

    while index < svg.len() {
        if let Some(attribute) = svg_icon_attribute_at(svg, index) {
            if let Some(parsed) = parse_quoted_attribute_value(svg, index + attribute.len()) {
                normalized.push_str(&svg[index..parsed.value_start]);
                let value = &svg[parsed.value_start..parsed.value_end];
                match attribute {
                    SvgIconAttribute::Color { .. } => {
                        normalized.push_str(&normalize_svg_icon_color_value(value));
                    }
                    SvgIconAttribute::Style => {
                        normalized.push_str(&normalize_svg_icon_style_value(value));
                    }
                }
                index = parsed.value_end;
                continue;
            }
        }

        let character = svg[index..]
            .chars()
            .next()
            .expect("index remains inside the svg string");
        normalized.push(character);
        index += character.len_utf8();
    }

    normalized
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SvgIconAttribute {
    Color { len: usize },
    Style,
}

impl SvgIconAttribute {
    fn len(self) -> usize {
        match self {
            Self::Color { len } => len,
            Self::Style => "style".len(),
        }
    }
}

fn svg_icon_attribute_at(svg: &str, index: usize) -> Option<SvgIconAttribute> {
    if !is_svg_attribute_start_boundary(svg, index) {
        return None;
    }

    for attribute in ["fill", "stroke"] {
        let attribute_end = index + attribute.len();
        if svg
            .get(index..attribute_end)
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(attribute))
            && is_svg_attribute_end_boundary(svg, attribute_end)
        {
            return Some(SvgIconAttribute::Color {
                len: attribute.len(),
            });
        }
    }

    let style_end = index + "style".len();
    if svg
        .get(index..style_end)
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case("style"))
        && is_svg_attribute_end_boundary(svg, style_end)
    {
        return Some(SvgIconAttribute::Style);
    }

    None
}

fn is_svg_attribute_start_boundary(svg: &str, index: usize) -> bool {
    if index == 0 {
        return true;
    }

    match svg[..index].chars().next_back() {
        Some(character) => !is_svg_attribute_name_character(character),
        None => true,
    }
}

fn is_svg_attribute_end_boundary(svg: &str, index: usize) -> bool {
    if index >= svg.len() {
        return true;
    }

    match svg[index..].chars().next() {
        Some(character) => !is_svg_attribute_name_character(character),
        None => true,
    }
}

fn is_svg_attribute_name_character(character: char) -> bool {
    matches!(
        character,
        'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | ':'
    )
}

struct SvgAttributeValue {
    value_start: usize,
    value_end: usize,
}

fn parse_quoted_attribute_value(svg: &str, mut index: usize) -> Option<SvgAttributeValue> {
    index = skip_html_whitespace(svg, index);
    if !svg[index..].starts_with('=') {
        return None;
    }

    index += 1;
    index = skip_html_whitespace(svg, index);
    let quote = svg[index..].chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }

    let value_start = index + quote.len_utf8();
    let value_end = svg[value_start..]
        .find(quote)
        .map(|offset| value_start + offset)?;
    Some(SvgAttributeValue {
        value_start,
        value_end,
    })
}

fn normalize_svg_icon_color_value(value: &str) -> String {
    if is_svg_icon_literal_color(value) {
        "currentColor".to_string()
    } else {
        value.to_string()
    }
}

fn normalize_svg_icon_style_value(style: &str) -> String {
    let mut normalized = String::with_capacity(style.len());
    let mut index = 0;

    while index < style.len() {
        if let Some(property) = svg_icon_style_color_property_at(style, index) {
            let after_property = index + property.len();
            if let Some((value_start, value_end)) =
                parse_svg_icon_style_declaration_value(style, after_property)
            {
                normalized.push_str(&style[index..value_start]);
                let value = &style[value_start..value_end];
                normalized.push_str(&normalize_svg_icon_color_value(value));
                index = value_end;
                continue;
            }
        }

        let character = style[index..]
            .chars()
            .next()
            .expect("index remains inside the style string");
        normalized.push(character);
        index += character.len_utf8();
    }

    normalized
}

fn svg_icon_style_color_property_at(style: &str, index: usize) -> Option<&'static str> {
    if !is_svg_style_property_start_boundary(style, index) {
        return None;
    }

    for property in ["fill", "stroke"] {
        let property_end = index + property.len();
        if style
            .get(index..property_end)
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(property))
            && is_svg_style_property_end_boundary(style, property_end)
        {
            return Some(property);
        }
    }

    None
}

fn is_svg_style_property_start_boundary(style: &str, index: usize) -> bool {
    if index == 0 {
        return true;
    }

    match style[..index].chars().next_back() {
        Some(character) => !is_svg_style_property_name_character(character),
        None => true,
    }
}

fn is_svg_style_property_end_boundary(style: &str, index: usize) -> bool {
    if index >= style.len() {
        return true;
    }

    match style[index..].chars().next() {
        Some(character) => !is_svg_style_property_name_character(character),
        None => true,
    }
}

fn is_svg_style_property_name_character(character: char) -> bool {
    matches!(character, 'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_')
}

fn parse_svg_icon_style_declaration_value(style: &str, mut index: usize) -> Option<(usize, usize)> {
    index = skip_html_whitespace(style, index);
    if !style[index..].starts_with(':') {
        return None;
    }

    let value_start = skip_html_whitespace(style, index + 1);
    let value_end = style[value_start..]
        .find(';')
        .map(|offset| value_start + offset)
        .unwrap_or(style.len());

    Some((value_start, value_end))
}

fn is_svg_icon_literal_color(value: &str) -> bool {
    let color = value
        .trim()
        .to_ascii_lowercase()
        .trim_end_matches("!important")
        .trim()
        .to_string();

    if color.is_empty()
        || matches!(
            color.as_str(),
            "none" | "currentcolor" | "inherit" | "initial" | "unset" | "revert" | "transparent"
        )
        || color.starts_with("var(")
    {
        return false;
    }

    if let Some(hex) = color.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8)
            && hex.chars().all(|character| character.is_ascii_hexdigit());
    }

    if ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|function| color.starts_with(function))
    {
        return true;
    }

    color
        .chars()
        .all(|character| character.is_ascii_alphabetic() || character == '-')
}

fn theme_bootstrap_script() -> &'static str {
    r#"
(() => {
  const VALID_MODES = new Set(['system', 'light', 'dark', 'dracula']);
  const MODE_FALLBACK = 'system';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const listeners = new Set();
  const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);
  // The Rust host injects the persisted mode as window.__leafSettings before
  // this script runs, so we resolve the right theme on the first paint. The
  // host owns persistence (the change handler reports back); there is no
  // localStorage here because the app shell's opaque origin never persists it.
  const injected = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings.themeMode : null;
  let mode = normalizeMode(injected);

  const resolvedTheme = () => {
    if (mode === 'light') return 'light';
    // Dracula is a dark palette: it resolves dark for color-scheme and any
    // dark/light consumers, and additionally flips on its own token source.
    if (mode === 'dark' || mode === 'dracula') return 'dark';
    return media && media.matches ? 'dark' : 'light';
  };
  const snapshot = () => ({ mode, resolvedTheme: resolvedTheme() });
  const apply = () => {
    const theme = snapshot();
    root.dataset.colorMode = mode === 'system' ? 'auto' : (mode === 'dracula' ? 'dark' : mode);
    root.dataset.lightTheme = 'light';
    root.dataset.darkTheme = 'dark';
    root.dataset.resolvedColorMode = theme.resolvedTheme;
    root.dataset.themeMode = mode;
    root.dataset.theme = theme.resolvedTheme;
    root.style.colorScheme = theme.resolvedTheme;
    // Dracula supplies its own complete token set via this attribute; every
    // other mode clears it so the Primer tokens drive the palette.
    if (mode === 'dracula') {
      root.dataset.leafThemeSource = 'dracula';
    } else {
      delete root.dataset.leafThemeSource;
    }
    listeners.forEach((listener) => listener(theme));
  };

  window.leafTheme = {
    getMode: () => mode,
    getResolvedTheme: resolvedTheme,
    setMode(nextMode) {
      mode = normalizeMode(nextMode);
      apply();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };

  if (media) {
    const onSystemThemeChange = () => { if (mode === 'system') { apply(); } };
    if (media.addEventListener) {
      media.addEventListener('change', onSystemThemeChange);
    } else if (media.addListener) {
      media.addListener(onSystemThemeChange);
    }
  }

  apply();
})();
"#
}

fn locale_bootstrap_script() -> &'static str {
    r#"
(() => {
  const STORAGE_KEY = 'leaf.localeMode';
  const MODE_FALLBACK = 'system';
  const VALID_MODES = new Set(['system', 'en', 'zh-CN']);
  const TRANSLATIONS = {
    en: {
      'actions.back': 'Back',
      'actions.back.title': 'Go back',
      'actions.chooseFile': 'Choose file',
      'actions.close': 'Close file',
      'actions.close.title': 'Close current file',
      'actions.closeTab': 'Close tab',
      'actions.copyCode': 'Copy code',
      'actions.copiedCode': 'Copied',
      'actions.anchorLink': 'Copy link to this spot',
      'actions.home': 'Home',
      'actions.home.title': 'Show recent files',
      'actions.forward': 'Forward',
      'actions.forward.title': 'Go forward',
      'actions.open': 'Open',
      'actions.open.title': 'Open Markdown file',
      'actions.revealFile': 'Reveal file',
      'actions.cut': 'Cut',
      'actions.copy': 'Copy',
      'actions.copyPath': 'Copy path',
      'actions.rename': 'Rename',
      'actions.properties': 'Properties',
      'actions.getInfo': 'Get Info',
      'actions.delete': 'Delete',
      'empty.description': 'Open any Markdown file for a calm, focused read. Turn over a new leaf.',
      'empty.description.incised': 'For two thousand years knowledge was incised on palm leaves — talipot and palmyra, dried and smoke-cured. Turn over a new one.',
      'empty.description.stylus': 'Scribes cut letters into palm leaves with a stylus, then rubbed in soot so the words rose to the surface. Read on.',
      'empty.description.bound': 'A palm-leaf book was threaded through a single hole and bound between wooden covers. Open yours.',
      'empty.description.lifespan': 'A palm leaf holds its text for a few decades — six hundred years at most — so temples recopied the old ones before they wore away.',
      'empty.description.roundLetters': 'The round letters of Devanagari, Kannada, and Telugu curved that way so sharp strokes would not tear the leaf.',
      'empty.description.lontar': 'In Indonesia these leaf-books were called lontar, from the old words for “leaf” and “palmyra palm.”',
      'empty.description.coldDry': 'The oldest palm-leaf manuscripts survived in cold, dry places — Nepal, Tibet, the high passes of central Asia.',
      'empty.description.bali': 'In Bali, Brahmin scribes still rewrite the sacred texts onto palm leaves by hand.',
      'empty.description.printing': 'The printing press ended the long cycle of copying palm leaf to palm leaf in the early 1800s.',
      'empty.kicker': 'Leaf Text',
      'empty.noRecent': 'Recent files will appear here after you open a document.',
      'empty.title': 'Markdown, made to read.',
      'errors.openFailed': 'Failed to open {path}: {reason}',
      'format.fileSizeUnknown': 'Unknown size',
      'library.title': 'Library',
      'library.view.toggle': 'Switch library view',
      'library.view.project': 'Project',
      'library.view.tree': 'Tree',
      'library.view.all': 'All files',
      'library.up': 'Back',
      'library.scanning': 'Scanning…',
      'library.filesFound': '{count} files found',
      'library.empty': 'No Markdown indexed yet.',
      'library.open': 'Open library',
      'library.divider.resize': 'Resize library',
      'library.search.placeholder': 'Search files…',
      'library.search.noResults': 'No matches.',
      'library.search.count': '{count} results',
      'library.search.loading': 'Searching…',
      'library.search.error': 'Search failed.',
      'recent.headingWithCount': 'Recent ({count})',
      'recent.openTitle': 'Open {path}',
      'minimap.aria': 'Document minimap',
      'settings.heading': 'Settings',
      'settings.indexing.label': 'Index entire device',
      'settings.indexing.help': 'Crawl this device for Markdown files and rescan each time you open the app.',
      'settings.theme.aria': 'Theme',
      'settings.theme.dark': 'Dark',
      'settings.theme.dracula': 'Dracula',
      'settings.theme.help': 'System follows device preference.',
      'settings.theme.label': 'Theme',
      'settings.theme.light': 'Light',
      'settings.theme.system': 'System',
      'settings.minimap.aria': 'Show document minimap',
      'settings.minimap.help': 'Show a scrollable document overview on wider windows.',
      'settings.minimap.label': 'Show minimap',
      'settings.speedReader.aria': 'Speed Reader',
      'settings.speedReader.help': 'Make prose quieter and add bold lead anchors for faster scanning.',
      'settings.speedReader.label': 'Speed Reader',
      'titles.app': 'Leaf Text',
      'titles.document': '{title} - Leaf Text',
    },
    'zh-CN': {
      'actions.chooseFile': '选择文件',
      'actions.close': '关闭文件',
      'actions.close.title': '关闭当前文件',
      'actions.closeTab': '关闭标签页',
      'actions.copyCode': '复制代码',
      'actions.copiedCode': '已复制',
      'actions.anchorLink': '复制此处的链接',
      'actions.home': '主页',
      'actions.home.title': '显示最近文件',
      'actions.open': '打开',
      'actions.open.title': '打开 Markdown 文件',
      'actions.revealFile': '在文件管理器中显示',
      'actions.cut': '剪切',
      'actions.copy': '复制',
      'actions.copyPath': '复制路径',
      'actions.rename': '重命名',
      'actions.properties': '属性',
      'actions.getInfo': '显示简介',
      'actions.delete': '删除',
      'empty.description': '打开任意 Markdown 文件，宁静专注地阅读，翻开新的一页。',
      'empty.description.incised': '两千年来，知识被刻写在棕榈叶上——经晾干烟熏的贝叶棕与糖棕。翻开新的一叶。',
      'empty.description.stylus': '抄写者以铁笔将文字刻入棕榈叶，再揉入烟灰，让字迹浮现。继续读下去。',
      'empty.description.bound': '贝叶经以一线穿孔串连，夹在木质封板之间。翻开你的那一卷。',
      'empty.description.lifespan': '一片棕榈叶能存字数十年，至多约六百年——于是寺院在旧叶朽坏前将其重抄。',
      'empty.description.roundLetters': '天城文、卡纳达文与泰卢固文的圆润字形，正是为了不让锋利的笔画划破叶面。',
      'empty.description.lontar': '在印度尼西亚，这些叶书被称为 lontar，源自古爪哇语中“叶”与“糖棕”二字。',
      'empty.description.coldDry': '最古老的贝叶写本留存于寒冷干燥之地——尼泊尔、西藏，以及中亚的高山隘口。',
      'empty.description.bali': '在巴厘岛，婆罗门抄经者至今仍以手将圣典重写于棕榈叶上。',
      'empty.description.printing': '十九世纪初，印刷术终结了贝叶之间世代相传的抄写。',
      'empty.kicker': 'Leaf Text',
      'empty.noRecent': '打开文档后，最近文件会显示在这里。',
      'empty.title': '为阅读而生的 Markdown。',
      'errors.openFailed': '无法打开 {path}：{reason}',
      'format.fileSizeUnknown': '大小未知',
      'library.title': '文库',
      'library.view.toggle': '切换文库视图',
      'library.view.project': '项目',
      'library.view.tree': '目录树',
      'library.view.all': '全部文件',
      'library.up': '返回',
      'library.scanning': '正在扫描…',
      'library.filesFound': '已找到 {count} 个文件',
      'library.empty': '尚未索引任何 Markdown 文件。',
      'library.open': '打开文库',
      'library.divider.resize': '调整文库宽度',
      'library.search.placeholder': '搜索文件…',
      'library.search.noResults': '无匹配结果。',
      'library.search.count': '{count} 条结果',
      'library.search.loading': '正在搜索…',
      'library.search.error': '搜索失败。',
      'recent.headingWithCount': '最近文件（{count}）',
      'recent.openTitle': '打开 {path}',
      'minimap.aria': '文档缩略图',
      'settings.heading': '设置',
      'settings.indexing.label': '索引整个设备',
      'settings.indexing.help': '扫描此设备上的 Markdown 文件，并在每次打开应用时重新扫描。',
      'settings.theme.aria': '主题',
      'settings.theme.dark': '深色',
      'settings.theme.dracula': 'Dracula',
      'settings.theme.help': '跟随系统显示偏好。',
      'settings.theme.label': '主题',
      'settings.theme.light': '浅色',
      'settings.theme.system': '跟随系统',
      'settings.minimap.aria': '显示文档缩略图',
      'settings.minimap.help': '在较宽窗口中显示可滚动的文档概览。',
      'settings.minimap.label': '显示缩略图',
      'settings.speedReader.aria': '快速阅读',
      'settings.speedReader.help': '弱化正文干扰，并为词首添加加粗引导，方便快速浏览。',
      'settings.speedReader.label': '快速阅读',
      'titles.app': 'Leaf Text',
      'titles.document': '{title} - Leaf Text',
    },  };
  const root = document.documentElement;
  const listeners = new Set();
  const createModeStorage = (storageKey) => ({
    read() {
      try {
        return window.localStorage ? window.localStorage.getItem(storageKey) : null;
      } catch (_) {
        return null;
      }
    },
    write(value) {
      try {
        if (window.localStorage) {
          window.localStorage.setItem(storageKey, value);
        }
      } catch (_) {}
    },
  });
  const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);
  const systemLanguage = () => {
    const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
    return languages[0] || navigator.language || '';
  };
  const resolveSystemLocale = () => {
    const language = String(systemLanguage()).trim().toLowerCase();
    return language.startsWith('zh') ? 'zh-CN' : 'en';
  };
  const resolveLocale = () => (mode === 'system' ? resolveSystemLocale() : mode);
  const interpolate = (message, values = {}) => message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
  const translate = (key, values = {}) => {
    const resolvedLocale = resolveLocale();
    const message = (TRANSLATIONS[resolvedLocale] && TRANSLATIONS[resolvedLocale][key]) || TRANSLATIONS.en[key] || key;
    return interpolate(message, values);
  };
  const snapshot = () => ({ mode, resolvedLocale: resolveLocale() });
  const apply = () => {
    const locale = snapshot();
    root.lang = locale.resolvedLocale;
    root.dataset.localeMode = locale.mode;
    root.dataset.locale = locale.resolvedLocale;
    listeners.forEach((listener) => listener(locale));
  };

  const storage = createModeStorage(STORAGE_KEY);
  let mode = normalizeMode(storage.read());

  window.leafLocale = {
    getMode: () => mode,
    getResolvedLocale: resolveLocale,
    setMode(nextMode) {
      mode = normalizeMode(nextMode);
      storage.write(mode);
      apply();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    t: translate,
    formatNumber(value, options) {
      return new Intl.NumberFormat(resolveLocale(), options).format(value);
    },
    formatDate(value, options) {
      return new Intl.DateTimeFormat(resolveLocale(), options).format(value);
    },
    formatRelativeTime(value, unit, options) {
      return new Intl.RelativeTimeFormat(resolveLocale(), options).format(value, unit);
    },
    formatFileSize(bytes) {
      const number = Number(bytes);
      if (!Number.isFinite(number)) {
        return translate('format.fileSizeUnknown');
      }
      const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
      let size = Math.abs(number);
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
      }
      const signedSize = number < 0 ? -size : size;
      return new Intl.NumberFormat(resolveLocale(), {
        maximumFractionDigits: unitIndex === 0 ? 0 : 1,
        style: 'unit',
        unit: units[unitIndex],
        unitDisplay: 'short',
      }).format(signedSize);
    },
  };

  window.addEventListener('languagechange', () => {
    if (mode === 'system') {
      apply();
    }
  });

  apply();
})();
"#
}

/// The initial workspace state as a `window.__leafInitialState` global. Like
/// [`initial_settings_script`], this is run as the webview's initialization
/// script — before any page script — so the page's boot bootstrap can apply it
/// on the first render. Injecting it after load via `evaluate_script` raced the
/// async page load: when the page won the race it ran its own empty bootstrap
/// last, wiping out the recent files.
pub fn initial_state_script(recent: &[PathBuf]) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "document": serde_json::Value::Null,
    });
    format!("window.__leafInitialState = {};", state)
}

/// The persisted UI toggles as a `window.__leafSettings` global. This is run as
/// the webview's initialization script — before any page script — so the theme
/// bootstrap and library pane render from the saved state on the first paint
/// instead of flashing defaults and re-applying. Keys are camelCase to match
/// what the frontend reads, independent of the snake_case on-disk format.
pub fn initial_settings_script(settings: &Settings) -> String {
    let state = serde_json::json!({
        "minimapEnabled": settings.minimap_enabled,
        "indexingEnabled": settings.indexing_enabled,
        "pagerEnabled": settings.pager_enabled,
        "speedReaderEnabled": settings.speed_reader_enabled,
        "themeMode": settings.theme_mode,
        "libraryView": settings.library_view.as_str(),
        "libraryExpanded": settings.library_expanded,
        "libraryProjectPath": settings.library_project_path,
        "libraryClosed": settings.library_closed,
        "libraryWidth": settings.library_width,
    });
    format!("window.__leafSettings = {};", state)
}

pub fn document_state_script(document: &OpenedDocument, recent: &[PathBuf]) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "document": document,
    });
    format!("window.leafSetState({});", state)
}

/// Build the full workspace state for the webview: recent files, the open tab
/// bar (title + path per tab), the active tab index (or `null` for the home
/// screen), and the active document (or `null` when the home screen is shown).
pub fn workspace_state_script(
    recent: &[PathBuf],
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let tabs: Vec<serde_json::Value> = tabs
        .iter()
        .map(|(title, path)| serde_json::json!({ "title": title, "path": path }))
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "tabs": tabs,
        "active": active,
        "document": document,
    });
    format!("window.leafSetState({});", state)
}

/// Like [`workspace_state_script`], but routes through `leafReloadDocument` so the
/// webview re-renders the active document in place while preserving the reader's
/// current scroll position. Used by the live-reload watcher when the open file
/// changes on disk, where jumping back to the top would be jarring.
pub fn workspace_reload_script(
    recent: &[PathBuf],
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let tabs: Vec<serde_json::Value> = tabs
        .iter()
        .map(|(title, path)| serde_json::json!({ "title": title, "path": path }))
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "tabs": tabs,
        "active": active,
        "document": document,
    });
    format!("window.leafReloadDocument({});", state)
}

/// A document-intrinsic scroll position. Instead of a raw pixel offset — which
/// points at different content every time the document is re-rendered and its
/// images settle the layout — this names the nearest heading slug above the
/// reader's top edge, the ordinal of the block within that section, and how far
/// through that block the reader has scrolled. The same Markdown always renders
/// the same blocks, so this survives a full re-render: switching tabs, history
/// navigation, and live reload all land back on the same paragraph.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ScrollAnchor {
    /// Heading slug the position sits under; `None` above the first heading.
    #[serde(default)]
    pub section: Option<String>,
    /// Zero-based block index within the section (the heading itself is 0).
    #[serde(default)]
    pub block: u32,
    /// Signed pixel offset of the reader's top edge from the block's top. Stays
    /// signed so the reading-mode top gap survives at the start of a document.
    #[serde(default, rename = "offsetY")]
    pub offset_y: f64,
}

/// Serialize an anchor to the JS object literal the webview restore hooks expect.
fn scroll_anchor_json(anchor: &ScrollAnchor) -> String {
    serde_json::to_string(anchor)
        .unwrap_or_else(|_| r#"{"section":null,"block":0,"offsetY":0}"#.to_string())
}

/// Like [`workspace_state_script`], but routes through `leafSwitchTab` so the
/// webview renders the target tab's document and then restores the saved scroll
/// anchor in the same frame. Switching tabs must never snap to the top, and
/// restoring as part of the render avoids racing the reset-to-top that
/// `leafSetState` performs. `anchor` is `None` the first time a tab is opened,
/// which lands the reader at the top of the content.
pub fn workspace_switch_script(
    recent: &[PathBuf],
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    anchor: Option<&ScrollAnchor>,
) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let tabs: Vec<serde_json::Value> = tabs
        .iter()
        .map(|(title, path)| serde_json::json!({ "title": title, "path": path }))
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "tabs": tabs,
        "active": active,
        "document": document,
    });
    let anchor = match anchor {
        Some(anchor) => scroll_anchor_json(anchor),
        None => "null".to_string(),
    };
    format!("window.leafSwitchTab({state}, {anchor});")
}

pub fn navigation_state_script(can_go_back: bool, can_go_forward: bool) -> String {
    let state = serde_json::json!({
        "canGoBack": can_go_back,
        "canGoForward": can_go_forward,
    });
    format!("window.leafSetNavigation({});", state)
}

pub fn fragment_scroll_script(fragment: &str) -> String {
    let fragment = serde_json::to_string(fragment).expect("fragment serializes");
    format!("window.leafScrollToFragment({fragment});")
}

/// Show a glossary term in the bottom sheet. `body_html` is the fully rendered
/// glossary document; the page extracts the entry whose heading id is `anchor`
/// and slides the sheet up over the current document.
pub fn glossary_sheet_script(body_html: &str, anchor: &str) -> String {
    let body_html = serde_json::to_string(body_html).expect("glossary html serializes");
    let anchor = serde_json::to_string(anchor).expect("glossary anchor serializes");
    format!("window.leafShowGlossary({body_html}, {anchor});")
}

/// Restore a saved scroll anchor in the current document without re-rendering.
/// Used by Back/Forward when the jump stays within the same document.
pub fn scroll_anchor_script(anchor: &ScrollAnchor) -> String {
    format!(
        "window.leafRestoreScrollAnchor({});",
        scroll_anchor_json(anchor)
    )
}

pub fn open_error_state_script(path: &Path, reason: &str) -> String {
    let path = serde_json::to_string(&path.display().to_string()).expect("path serializes");
    let reason = serde_json::to_string(reason).expect("error reason serializes");
    format!("window.leafShowOpenError({path}, {reason});")
}

pub fn config_file_path() -> Option<PathBuf> {
    ProjectDirs::from("com", "ryanallen", "leaftext")
        .map(|dirs| dirs.config_dir().join("recent-files.json"))
}

pub fn webview_user_data_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "ryanallen", "leaftext")
        .map(|dirs| dirs.data_local_dir().join("webview2"))
}

/// The app data root for leaftext's own files (the indexer manifest lives here).
/// Deliberately the local data dir itself, not the WebView2 cache subfolder, so
/// the manifest database is not entangled with the embedded browser's storage.
pub fn app_data_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "ryanallen", "leaftext")
        .map(|dirs| dirs.data_local_dir().to_path_buf())
}

pub fn load_recent_files(config_path: impl AsRef<Path>) -> RecentFiles {
    let mut recent: RecentFiles = fs::read_to_string(config_path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default();
    recent.normalize_entries();
    recent
}

pub fn save_recent_files(config_path: impl AsRef<Path>, recent: &RecentFiles) -> io::Result<()> {
    let config_path = config_path.as_ref();
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(recent)?;
    fs::write(config_path, json)
}

/// User-facing UI toggles that must survive a restart. The webview's
/// localStorage is not durable for the app shell's opaque origin, so the host
/// owns these: they are injected on boot via [`initial_settings_script`] and saved
/// (`save_settings`) whenever the frontend reports a change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub indexing_enabled: bool,
    pub minimap_enabled: bool,
    /// Whether to append the automatic Previous/Next pager at the bottom of every
    /// document. On by default; the settings menu can turn it off.
    pub pager_enabled: bool,
    /// Whether to visually quiet prose and add bold lead anchors at word starts.
    /// Off by default; this is a reversible view setting.
    pub speed_reader_enabled: bool,
    /// The theme mode the frontend last selected: `system`, `light`, `dark`, or
    /// `dracula`. Stored as the raw mode string the frontend understands; the
    /// frontend normalizes anything unexpected back to `system`.
    pub theme_mode: String,
    /// Which library view is showing: drill-in Project, expandable Tree, or flat.
    pub library_view: LibraryView,
    /// Full paths of folders left expanded in Tree view, so the open/closed
    /// shape is restored across view switches and restarts.
    pub library_expanded: Vec<String>,
    /// The folder Project view is currently inside (empty string = the root).
    pub library_project_path: String,
    /// Whether the user has collapsed the library pane shut. Open by default.
    pub library_closed: bool,
    /// The pane's last open width in CSS px, restored on reopen. The frontend
    /// re-clamps it to the current window, so it is a preference, not a command.
    pub library_width: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            indexing_enabled: false,
            minimap_enabled: true,
            pager_enabled: true,
            speed_reader_enabled: false,
            theme_mode: "system".to_string(),
            library_view: LibraryView::default(),
            library_expanded: Vec::new(),
            library_project_path: String::new(),
            library_closed: false,
            library_width: 240,
        }
    }
}

/// The library pane's three layouts. Serialized lowercase (`"project"`,
/// `"tree"`, `"flat"`) to match the frontend's `LIBRARY_VIEWS` strings.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryView {
    #[default]
    Project,
    Tree,
    Flat,
}

impl LibraryView {
    pub fn as_str(self) -> &'static str {
        match self {
            LibraryView::Project => "project",
            LibraryView::Tree => "tree",
            LibraryView::Flat => "flat",
        }
    }

    /// Parse a value sent by the frontend, ignoring anything unrecognized.
    pub fn from_client(value: &str) -> Option<Self> {
        match value {
            "project" => Some(LibraryView::Project),
            "tree" => Some(LibraryView::Tree),
            "flat" => Some(LibraryView::Flat),
            _ => None,
        }
    }
}

pub fn settings_file_path() -> Option<PathBuf> {
    ProjectDirs::from("com", "ryanallen", "leaftext")
        .map(|dirs| dirs.config_dir().join("settings.json"))
}

/// Load the persisted UI toggles, falling back to defaults when the file is
/// missing or corrupt (matching `load_recent_files`'s forgiving behavior).
pub fn load_settings(settings_path: impl AsRef<Path>) -> Settings {
    fs::read_to_string(settings_path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

pub fn save_settings(settings_path: impl AsRef<Path>, settings: &Settings) -> io::Result<()> {
    let settings_path = settings_path.as_ref();
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(settings)?;
    fs::write(settings_path, json)
}

#[derive(Debug, Clone, Copy)]
struct MarkdownSource<'a> {
    markdown: &'a str,
    source_path: &'a Path,
}

#[derive(Debug, Clone, Copy)]
struct MarkdownParserConfig {
    options: Options,
}

impl MarkdownParserConfig {
    fn github_flavored() -> Self {
        Self {
            options: markdown_options(),
        }
    }
}

fn render_markdown_body(source: MarkdownSource<'_>) -> String {
    // A leading `--- ... ---` frontmatter block renders as a small metadata table
    // at the top of the document, not as raw Markdown (which would otherwise turn
    // into a stray heading/thematic break). The rest of the file renders normally.
    let (frontmatter_html, body_markdown) = match split_leading_frontmatter(source.markdown) {
        Some((inner, rest)) => (render_frontmatter_table(&inner), rest),
        None => (String::new(), source.markdown),
    };
    let parser_config = MarkdownParserConfig::github_flavored();
    let events = parse_markdown_source(body_markdown, parser_config);
    let events = sanitize_raw_markdown_html(events);
    let events = register_markdown_extensions(events, source.source_path);
    let body = render_markdown_events_to_html(events);
    let body = resolve_rendered_html_image_urls(&body, source.source_path);
    let body = format!("{frontmatter_html}{body}");
    sanitize_rendered_html(&body)
}

/// Split a leading `--- ... ---` frontmatter block off the front of the document,
/// returning the block's inner text and the Markdown that follows it. Detected
/// only when `---` is the very first line (after an optional UTF-8 BOM) and a
/// later `---` line closes it — the same rule the indexer uses.
fn split_leading_frontmatter(markdown: &str) -> Option<(String, &str)> {
    let after_bom = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    let first_end = after_bom
        .find('\n')
        .map(|i| i + 1)
        .unwrap_or(after_bom.len());
    if after_bom[..first_end]
        .trim_end_matches(['\r', '\n'])
        .trim_end()
        != "---"
    {
        return None;
    }
    let inner_start = first_end;
    let mut offset = first_end;
    while offset < after_bom.len() {
        let line_end = after_bom[offset..]
            .find('\n')
            .map(|i| offset + i + 1)
            .unwrap_or(after_bom.len());
        if after_bom[offset..line_end]
            .trim_end_matches(['\r', '\n'])
            .trim_end()
            == "---"
        {
            return Some((
                after_bom[inner_start..offset].to_string(),
                &after_bom[line_end..],
            ));
        }
        offset = line_end;
    }
    None
}

/// Render a parsed frontmatter block as a compact `key`/`value` metadata table.
/// Returns an empty string when nothing parses, so a malformed block just renders
/// as no table (the body is still stripped of it). Every cell is file-derived and
/// untrusted, so it is escaped before reaching the DOM.
fn render_frontmatter_table(inner: &str) -> String {
    let block = crate::indexer::FrontmatterBlock {
        body: inner.to_string(),
    };
    let fields = crate::indexer::parse_frontmatter(&block)
        .map(|parsed| parsed.fields)
        .unwrap_or_default();
    if fields.is_empty() {
        return String::new();
    }
    let mut rows = String::new();
    for field in &fields {
        rows.push_str("<tr><th>");
        rows.push_str(&encode_text(&field.key));
        rows.push_str("</th><td>");
        rows.push_str(&encode_text(&field.value));
        rows.push_str("</td></tr>");
    }
    format!(r#"<div class="frontmatter"><table><tbody>{rows}</tbody></table></div>"#)
}

fn parse_markdown_source(
    markdown: &str,
    parser_config: MarkdownParserConfig,
) -> Vec<Event<'static>> {
    Parser::new_ext(markdown, parser_config.options)
        .map(Event::into_static)
        .collect()
}

fn register_markdown_extensions(
    events: Vec<Event<'static>>,
    source_path: &Path,
) -> Vec<Event<'static>> {
    let repository = repository_context(source_path.parent().unwrap_or_else(|| Path::new(".")));
    let events = linkify_plain_text(events);
    let events = github_markdown_extras(events, repository.as_ref());
    let events = add_markdown_heading_ids(events);
    let events = resolve_absolute_markdown_image_urls(events, source_path);
    fill_image_titles_from_alt(events)
}

fn render_markdown_events_to_html(events: Vec<Event<'static>>) -> String {
    let mut body = String::new();
    html::push_html(&mut body, events.into_iter());
    body
}

fn add_markdown_heading_ids(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut transformed = Vec::with_capacity(events.len());
    let mut seen = HashSet::new();
    let mut heading: Option<HeadingIdCapture> = None;

    for event in events {
        if let Some(capture) = &mut heading {
            match event {
                Event::End(TagEnd::Heading(level)) => {
                    let slug = unique_heading_slug(&capture.text, &mut seen);
                    transformed.push(Event::Start(Tag::Heading {
                        level,
                        id: Some(cowstr(&slug)),
                        classes: capture.classes.clone(),
                        attrs: capture.attrs.clone(),
                    }));
                    transformed.extend(capture.events.drain(..));
                    transformed.push(Event::End(TagEnd::Heading(level)));
                    heading = None;
                }
                other => {
                    append_heading_slug_text(&other, &mut capture.text);
                    capture.events.push(other);
                }
            }
            continue;
        }

        match event {
            Event::Start(Tag::Heading {
                level,
                id: Some(id),
                classes,
                attrs,
            }) => {
                seen.insert(id.to_string());
                transformed.push(Event::Start(Tag::Heading {
                    level,
                    id: Some(id),
                    classes,
                    attrs,
                }));
            }
            Event::Start(Tag::Heading {
                level,
                id: None,
                classes,
                attrs,
            }) => {
                heading = Some(HeadingIdCapture {
                    level,
                    classes,
                    attrs,
                    events: Vec::new(),
                    text: String::new(),
                });
            }
            other => transformed.push(other),
        }
    }

    if let Some(mut capture) = heading {
        let slug = unique_heading_slug(&capture.text, &mut seen);
        transformed.push(Event::Start(Tag::Heading {
            level: capture.level,
            id: Some(cowstr(&slug)),
            classes: capture.classes,
            attrs: capture.attrs,
        }));
        transformed.extend(capture.events.drain(..));
    }

    transformed
}

#[derive(Debug)]
struct HeadingIdCapture {
    level: HeadingLevel,
    classes: Vec<CowStr<'static>>,
    attrs: Vec<(CowStr<'static>, Option<CowStr<'static>>)>,
    events: Vec<Event<'static>>,
    text: String,
}

pub(crate) fn append_heading_slug_text(event: &Event<'_>, text: &mut String) {
    match event {
        Event::Text(value) | Event::Code(value) => text.push_str(value.as_ref()),
        Event::InlineHtml(value) | Event::Html(value) => {
            text.push_str(&strip_html_tags(value.as_ref()));
        }
        Event::SoftBreak | Event::HardBreak => text.push(' '),
        _ => {}
    }
}

fn strip_html_tags(value: &str) -> String {
    let mut stripped = String::with_capacity(value.len());
    let mut in_tag = false;

    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => stripped.push(character),
            _ => {}
        }
    }

    stripped
}

pub(crate) fn unique_heading_slug(text: &str, seen: &mut HashSet<String>) -> String {
    let base = heading_slug_base(text);
    if seen.insert(base.clone()) {
        return base;
    }

    let mut index = 1usize;
    loop {
        let candidate = format!("{base}-{index}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
        index += 1;
    }
}

fn heading_slug_base(text: &str) -> String {
    let normalized = text.trim().to_lowercase();
    let mut slug = String::with_capacity(normalized.len());

    for character in normalized.chars() {
        if character.is_alphanumeric() || matches!(character, '_' | '-') {
            slug.push(character);
        } else if character.is_whitespace() {
            slug.push('-');
        }
    }

    if slug.is_empty() {
        "heading".to_string()
    } else {
        slug
    }
}

fn sanitize_raw_markdown_html(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut sanitized = Vec::with_capacity(events.len());
    let mut skipped_raw_html_content: Option<&'static str> = None;

    for event in events {
        if let Some(tag_name) = skipped_raw_html_content {
            if let Event::Html(html) | Event::InlineHtml(html) = &event {
                if closes_raw_html_content_tag(html, tag_name) {
                    skipped_raw_html_content = None;
                }
            }
            continue;
        }

        match event {
            Event::Html(html) => {
                if let Some(tag_name) = opens_unclosed_raw_html_content_tag(&html) {
                    skipped_raw_html_content = Some(tag_name);
                }
                sanitized.push(Event::Html(cowstr(&sanitize_raw_markdown_html_fragment(
                    &html,
                ))));
            }
            Event::InlineHtml(html) => {
                if let Some(tag_name) = opens_unclosed_raw_html_content_tag(&html) {
                    skipped_raw_html_content = Some(tag_name);
                }
                sanitized.push(Event::InlineHtml(cowstr(
                    &sanitize_raw_markdown_html_fragment(&html),
                )));
            }
            _ => sanitized.push(event),
        }
    }

    sanitized
}

pub(crate) fn markdown_options() -> Options {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_GFM);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_MATH);
    options
}

fn linkify_plain_text(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut finder = LinkFinder::new();
    finder
        .kinds(&[LinkKind::Url, LinkKind::Email])
        .url_must_have_scheme(false);

    let mut link_depth = 0usize;
    let mut transformed = Vec::new();

    for event in events {
        match event {
            Event::Start(Tag::Link { .. }) | Event::Start(Tag::Image { .. }) => {
                link_depth += 1;
                transformed.push(event);
            }
            Event::End(TagEnd::Link) | Event::End(TagEnd::Image) => {
                link_depth = link_depth.saturating_sub(1);
                transformed.push(event);
            }
            Event::Text(text) if link_depth == 0 => {
                append_autolink_events(text.as_ref(), &finder, &mut transformed);
            }
            _ => transformed.push(event),
        }
    }

    transformed
}

fn github_markdown_extras(
    events: Vec<Event<'static>>,
    repository: Option<&RepositoryContext>,
) -> Vec<Event<'static>> {
    let mut transformed = Vec::new();
    let mut link_depth = 0usize;
    let mut code_block: Option<CodeBlockCapture> = None;
    let mut footnotes = FootnoteTracker::default();
    let mut current_footnote: Option<String> = None;
    // Where each footnote definition's events landed in `transformed`, so they
    // can be hoisted to the end of the document (as GitHub does) once every
    // reference has been numbered. pulldown-cmark emits definitions wherever
    // they appear in the source, which would otherwise strand them mid-document.
    let mut footnote_ranges: Vec<(String, usize, usize)> = Vec::new();
    let mut footnote_start = 0usize;

    for event in events {
        if let Some(capture) = &mut code_block {
            match event {
                Event::Text(text) => capture.code.push_str(text.as_ref()),
                Event::End(TagEnd::CodeBlock) => {
                    transformed.push(Event::Html(cowstr(&render_code_block(capture))));
                    code_block = None;
                }
                _ => {}
            }
            continue;
        }

        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(info))) => {
                code_block = Some(CodeBlockCapture {
                    language: info
                        .split_whitespace()
                        .next()
                        .map(str::to_string)
                        .filter(|language| !language.is_empty()),
                    code: String::new(),
                });
            }
            Event::Start(Tag::Link { .. }) | Event::Start(Tag::Image { .. }) => {
                link_depth += 1;
                transformed.push(event);
            }
            Event::End(TagEnd::Link) | Event::End(TagEnd::Image) => {
                link_depth = link_depth.saturating_sub(1);
                transformed.push(event);
            }
            Event::Text(text) if link_depth == 0 => {
                append_github_text_events(text.as_ref(), repository, &mut transformed);
            }
            Event::Start(Tag::FootnoteDefinition(name)) => {
                current_footnote = Some(name.to_string());
                footnote_start = transformed.len();
                transformed.push(Event::Start(Tag::FootnoteDefinition(name)));
            }
            Event::End(TagEnd::FootnoteDefinition) => {
                if let Some(name) = current_footnote.take() {
                    let backlink = Event::Html(cowstr(&render_footnote_backlink(&name)));
                    // Insert inside the last paragraph so the icon sits inline at the
                    // end of the sentence rather than as a separate block below it.
                    let last_para_end = (footnote_start..transformed.len())
                        .rev()
                        .find(|&i| matches!(transformed[i], Event::End(TagEnd::Paragraph)));
                    if let Some(idx) = last_para_end {
                        transformed.insert(idx, backlink);
                    } else {
                        transformed.push(backlink);
                    }
                    transformed.push(Event::End(TagEnd::FootnoteDefinition));
                    footnote_ranges.push((name, footnote_start, transformed.len()));
                } else {
                    transformed.push(Event::End(TagEnd::FootnoteDefinition));
                }
            }
            Event::FootnoteReference(name) => {
                transformed.push(Event::Html(cowstr(&footnotes.render_reference(&name))));
            }
            Event::DisplayMath(text) => {
                transformed.push(Event::DisplayMath(cowstr(text.trim())));
            }
            Event::InlineMath(text) => {
                transformed.push(Event::InlineMath(cowstr(text.trim())));
            }
            _ => transformed.push(event),
        }
    }

    if let Some(capture) = &code_block {
        transformed.push(Event::Html(cowstr(&render_code_block(capture))));
    }

    relocate_footnote_definitions(transformed, footnote_ranges, &footnotes)
}

/// Move every footnote definition to the end of the document, ordered to match
/// the numbers assigned to their references (first-referenced first), with any
/// unreferenced definitions trailing in source order. This mirrors GitHub: notes
/// collect in one block at the bottom regardless of where they were written.
///
/// pulldown-cmark's HTML writer labels each definition by the order it is
/// emitted, so emitting them in reference order also makes the printed labels
/// line up with the superscript reference numbers.
fn relocate_footnote_definitions(
    events: Vec<Event<'static>>,
    ranges: Vec<(String, usize, usize)>,
    footnotes: &FootnoteTracker,
) -> Vec<Event<'static>> {
    if ranges.is_empty() {
        return events;
    }

    // Stable sort keeps unreferenced definitions (usize::MAX key) in source
    // order, and keeps the relative order of any definitions sharing a number.
    let mut order: Vec<usize> = (0..ranges.len()).collect();
    order.sort_by_key(|&i| footnotes.number_of(&ranges[i].0).unwrap_or(usize::MAX));

    let mut covered = vec![false; events.len()];
    for (_, start, end) in &ranges {
        for slot in covered.iter_mut().take(*end).skip(*start) {
            *slot = true;
        }
    }

    let mut slots: Vec<Option<Event<'static>>> = events.into_iter().map(Some).collect();
    let mut result = Vec::with_capacity(slots.len());
    for index in 0..slots.len() {
        if !covered[index] {
            result.push(slots[index].take().expect("event taken once"));
        }
    }
    for &i in &order {
        let (_, start, end) = &ranges[i];
        for index in *start..*end {
            result.push(slots[index].take().expect("footnote event taken once"));
        }
    }
    result
}

#[derive(Debug, Clone)]
struct CodeBlockCapture {
    language: Option<String>,
    code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RepositoryContext {
    owner: String,
    repo: String,
}

#[derive(Debug, Default)]
struct FootnoteTracker {
    numbers: HashMap<String, usize>,
}

impl FootnoteTracker {
    fn render_reference(&mut self, name: &str) -> String {
        let number = if let Some(number) = self.numbers.get(name) {
            *number
        } else {
            let number = self.numbers.len() + 1;
            self.numbers.insert(name.to_string(), number);
            number
        };

        format!(
            r##"<sup class="footnote-reference" id="fnref-{}"><a href="#{}">{}</a></sup>"##,
            encode_double_quoted_attribute(name),
            encode_double_quoted_attribute(name),
            number
        )
    }

    /// The number assigned to a footnote, or `None` if it was never referenced.
    fn number_of(&self, name: &str) -> Option<usize> {
        self.numbers.get(name).copied()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum GithubToken {
    Issue {
        owner: String,
        repo: String,
        number: String,
        text: String,
    },
    Commit {
        owner: String,
        repo: String,
        hash: String,
    },
    Mention {
        text: String,
    },
    Emoji {
        shortcode: String,
        glyph: &'static str,
    },
}

fn append_github_text_events(
    text: &str,
    repository: Option<&RepositoryContext>,
    events: &mut Vec<Event<'static>>,
) {
    let mut offset = 0;

    while offset < text.len() {
        if let Some((start, end, token)) = next_github_token(&text[offset..], repository) {
            if start > 0 {
                events.push(Event::Text(cowstr(&text[offset..offset + start])));
            }
            events.push(Event::Html(cowstr(&render_github_token(&token))));
            offset += end;
        } else {
            events.push(Event::Text(cowstr(&text[offset..])));
            break;
        }
    }
}

fn next_github_token(
    text: &str,
    repository: Option<&RepositoryContext>,
) -> Option<(usize, usize, GithubToken)> {
    text.char_indices()
        .filter_map(|(index, char)| {
            if index > 0 && !is_token_boundary(text[..index].chars().last()) {
                return None;
            }

            let tail = &text[index..];
            let token = match char {
                ':' => emoji_token(tail),
                '@' => mention_token(tail),
                '#' => issue_token(tail, repository),
                'A'..='Z' | 'a'..='z' | '0'..='9' => {
                    issue_token(tail, repository).or_else(|| commit_token(tail, repository))
                }
                _ => None,
            }?;
            Some((index, index + token_text_len(&token), token))
        })
        .next()
}

fn token_text_len(token: &GithubToken) -> usize {
    match token {
        GithubToken::Issue { text, .. } => text.len(),
        GithubToken::Commit { hash, .. } => hash.len(),
        GithubToken::Mention { text } => text.len(),
        GithubToken::Emoji { shortcode, .. } => shortcode.len(),
    }
}

fn emoji_token(text: &str) -> Option<GithubToken> {
    let rest = text.strip_prefix(':')?;
    let end = rest.find(':')? + 2;
    let shortcode = &text[..end];
    let glyph = match shortcode {
        ":shipit:" => "🚢",
        ":rocket:" => "🚀",
        ":tada:" => "🎉",
        ":warning:" => "⚠️",
        ":white_check_mark:" => "✅",
        _ => return None,
    };

    Some(GithubToken::Emoji {
        shortcode: shortcode.to_string(),
        glyph,
    })
}

fn mention_token(text: &str) -> Option<GithubToken> {
    let username_end = take_identifier(&text[1..])? + 1;
    let mut end = username_end;

    if text[username_end..].starts_with('/') {
        let team_start = username_end + 1;
        end = take_identifier(&text[team_start..])? + team_start;
    }

    if !is_token_boundary(text[end..].chars().next()) {
        return None;
    }

    Some(GithubToken::Mention {
        text: text[..end].to_string(),
    })
}

fn issue_token(text: &str, repository: Option<&RepositoryContext>) -> Option<GithubToken> {
    if let Some(number) = text.strip_prefix('#').and_then(take_digits_text) {
        let repository = repository?;
        return issue_token_with_context(repository, number, &format!("#{number}"));
    }

    if let Some(number) = text.strip_prefix("GH-").and_then(take_digits_text) {
        let repository = repository?;
        return issue_token_with_context(repository, number, &format!("GH-{number}"));
    }

    let owner_end = take_identifier(text)?;
    if !text[owner_end..].starts_with('/') {
        return None;
    }
    let repo_start = owner_end + 1;
    let repo_end = take_repo_name(&text[repo_start..])? + repo_start;
    if !text[repo_end..].starts_with('#') {
        return None;
    }
    let number_start = repo_end + 1;
    let number = take_digits_text(&text[number_start..])?;
    if !is_token_boundary(text[number_start + number.len()..].chars().next()) {
        return None;
    }

    issue_token_with_context(
        &RepositoryContext {
            owner: text[..owner_end].to_string(),
            repo: text[repo_start..repo_end].to_string(),
        },
        number,
        &text[..number_start + number.len()],
    )
}

fn issue_token_with_context(
    repository: &RepositoryContext,
    number: &str,
    text: &str,
) -> Option<GithubToken> {
    Some(GithubToken::Issue {
        owner: repository.owner.clone(),
        repo: repository.repo.clone(),
        number: number.to_string(),
        text: text.to_string(),
    })
}

fn commit_token(text: &str, repository: Option<&RepositoryContext>) -> Option<GithubToken> {
    let repository = repository?;
    let hash_len = text
        .chars()
        .take_while(|char| char.is_ascii_hexdigit())
        .count();
    if hash_len != 7 && hash_len != 40 {
        return None;
    }
    let hash = &text[..hash_len];
    if !hash.chars().any(|char| char.is_ascii_alphabetic())
        || !is_token_boundary(text[hash_len..].chars().next())
    {
        return None;
    }

    Some(GithubToken::Commit {
        owner: repository.owner.clone(),
        repo: repository.repo.clone(),
        hash: hash.to_string(),
    })
}

fn take_identifier(text: &str) -> Option<usize> {
    let mut end = 0;
    for (index, char) in text.char_indices() {
        if char.is_ascii_alphanumeric() || char == '-' {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    (end > 0).then_some(end)
}

fn take_repo_name(text: &str) -> Option<usize> {
    let mut end = 0;
    for (index, char) in text.char_indices() {
        if char.is_ascii_alphanumeric() || char == '-' || char == '_' || char == '.' {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    (end > 0).then_some(end)
}

fn take_digits_text(text: &str) -> Option<&str> {
    let end = text
        .char_indices()
        .take_while(|(_, char)| char.is_ascii_digit())
        .map(|(index, char)| index + char.len_utf8())
        .last()?;
    Some(&text[..end])
}

fn is_token_boundary(char: Option<char>) -> bool {
    char.map(|char| {
        !(char.is_ascii_alphanumeric() || matches!(char, '_' | '-' | '/' | '#' | '@' | ':'))
    })
    .unwrap_or(true)
}

fn render_github_token(token: &GithubToken) -> String {
    match token {
        GithubToken::Issue {
            owner,
            repo,
            number,
            text,
        } => format!(
            r#"<a class="github-ref issue-ref" href="https://github.com/{}/{}/issues/{}">{}</a>"#,
            encode_double_quoted_attribute(owner),
            encode_double_quoted_attribute(repo),
            encode_double_quoted_attribute(number),
            encode_text(text)
        ),
        GithubToken::Commit { owner, repo, hash } => format!(
            r#"<a class="github-ref commit-ref" href="https://github.com/{}/{}/commit/{}"><code>{}</code></a>"#,
            encode_double_quoted_attribute(owner),
            encode_double_quoted_attribute(repo),
            encode_double_quoted_attribute(hash),
            encode_text(hash)
        ),
        GithubToken::Mention { text } => format!(
            r#"<span class="github-mention">{}</span>"#,
            encode_text(text)
        ),
        GithubToken::Emoji { shortcode, glyph } => format!(
            r#"<span class="emoji" title="{}" aria-label="{}">{}</span>"#,
            encode_double_quoted_attribute(shortcode),
            encode_double_quoted_attribute(shortcode),
            glyph
        ),
    }
}

fn render_footnote_backlink(name: &str) -> String {
    format!(
        r##"<a class="footnote-backref" href="#fnref-{}" aria-label="Back to content">{}</a>"##,
        encode_double_quoted_attribute(name),
        footnote_backref_icon_svg()
    )
}

fn footnote_backref_icon_svg() -> &'static str {
    static ICON: OnceLock<String> = OnceLock::new();

    ICON.get_or_init(|| {
        normalize_svg_icon_colors(FOOTNOTE_BACKREF_ICON_SVG)
            .trim()
            .to_string()
    })
    .as_str()
}

fn render_code_block(capture: &CodeBlockCapture) -> String {
    let Some(language) = capture.language.as_deref() else {
        return format!("<pre><code>{}</code></pre>", encode_text(&capture.code));
    };

    if language.eq_ignore_ascii_case("mermaid") {
        return render_mermaid_code_block(&capture.code);
    }

    let requested_language = language;
    let language = language_definition(requested_language);
    let display_language = language
        .as_ref()
        .map(|language| language.display_name)
        .unwrap_or(requested_language);
    let language_class = format!("language-{}", safe_css_identifier(display_language));
    let highlighted = language
        .and_then(|language| highlight_code(&capture.code, &language))
        .unwrap_or_else(|| encode_text(&capture.code).to_string());
    format!(
        r#"<pre class="highlight" data-language="{}"><code class="{}">{}</code></pre>"#,
        encode_double_quoted_attribute(display_language),
        encode_double_quoted_attribute(&language_class),
        highlighted
    )
}

fn render_mermaid_code_block(code: &str) -> String {
    format!(
        r#"<pre class="mermaid" data-language="mermaid">{}</pre>"#,
        encode_text(mermaid_source_for_runtime(code))
    )
}

fn mermaid_source_for_runtime(code: &str) -> &str {
    strip_mermaid_yaml_frontmatter(code).unwrap_or(code)
}

fn strip_mermaid_yaml_frontmatter(code: &str) -> Option<&str> {
    let first_line_end = code.find('\n')?;
    let first_line = code[..first_line_end].trim_end_matches('\r');
    if first_line.trim() != "---" {
        return None;
    }

    let mut offset = first_line_end + 1;
    for line in code[offset..].split_inclusive('\n') {
        let line_without_newline = line
            .strip_suffix('\n')
            .unwrap_or(line)
            .trim_end_matches('\r');
        let next_offset = offset + line.len();
        if line_without_newline.trim() == "---" {
            return Some(&code[next_offset..]);
        }
        offset = next_offset;
    }

    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LanguageDefinition {
    display_name: &'static str,
    syntax_names: &'static [&'static str],
    syntax_tokens: &'static [&'static str],
}

fn language_definition(language: &str) -> Option<LanguageDefinition> {
    let normalized = language.trim().to_ascii_lowercase();
    let definition = match normalized.as_str() {
        "ts" | "typescript" => LanguageDefinition {
            display_name: "TypeScript",
            syntax_names: &["TypeScript"],
            syntax_tokens: &["ts", "typescript"],
        },
        "tsx" => LanguageDefinition {
            display_name: "TSX",
            syntax_names: &["TSX", "TypeScriptReact"],
            syntax_tokens: &["tsx"],
        },
        "js" | "javascript" => LanguageDefinition {
            display_name: "JavaScript",
            syntax_names: &["JavaScript"],
            syntax_tokens: &["js", "javascript"],
        },
        "jsx" => LanguageDefinition {
            display_name: "JSX",
            syntax_names: &["JSX", "JavaScriptReact"],
            syntax_tokens: &["jsx"],
        },
        "json" => LanguageDefinition {
            display_name: "JSON",
            syntax_names: &["JSON"],
            syntax_tokens: &["json"],
        },
        "jsonc" => LanguageDefinition {
            display_name: "JSONC",
            syntax_names: &["JSONC", "JSON with Comments", "JSON"],
            syntax_tokens: &["jsonc", "json"],
        },
        "html" => LanguageDefinition {
            display_name: "HTML",
            syntax_names: &["HTML"],
            syntax_tokens: &["html"],
        },
        "css" => LanguageDefinition {
            display_name: "CSS",
            syntax_names: &["CSS"],
            syntax_tokens: &["css"],
        },
        "scss" => LanguageDefinition {
            display_name: "SCSS",
            syntax_names: &["SCSS", "CSS"],
            syntax_tokens: &["scss", "css"],
        },
        "md" | "markdown" => LanguageDefinition {
            display_name: "Markdown",
            syntax_names: &["Markdown"],
            syntax_tokens: &["md", "markdown"],
        },
        "bash" | "sh" | "shell" | "zsh" => LanguageDefinition {
            display_name: "Bash",
            syntax_names: &[
                "Bourne Again Shell (bash)",
                "Shell-Unix-Generic",
                "ShellScript",
                "Bash",
            ],
            syntax_tokens: &["bash", "sh", "shell", "zsh"],
        },
        "yaml" | "yml" => LanguageDefinition {
            display_name: "YAML",
            syntax_names: &["YAML"],
            syntax_tokens: &["yaml", "yml"],
        },
        "toml" => LanguageDefinition {
            display_name: "TOML",
            syntax_names: &["TOML"],
            syntax_tokens: &["toml"],
        },
        "xml" => LanguageDefinition {
            display_name: "XML",
            syntax_names: &["XML"],
            syntax_tokens: &["xml"],
        },
        "rust" | "rs" => LanguageDefinition {
            display_name: "Rust",
            syntax_names: &["Rust"],
            syntax_tokens: &["rs", "rust"],
        },
        "python" | "py" => LanguageDefinition {
            display_name: "Python",
            syntax_names: &["Python"],
            syntax_tokens: &["python", "py"],
        },
        "sql" => LanguageDefinition {
            display_name: "SQL",
            syntax_names: &["SQL"],
            syntax_tokens: &["sql"],
        },
        "diff" | "patch" => LanguageDefinition {
            display_name: "Diff",
            syntax_names: &["Diff"],
            syntax_tokens: &["diff", "patch"],
        },
        "ini" => LanguageDefinition {
            display_name: "INI",
            syntax_names: &["INI"],
            syntax_tokens: &["ini"],
        },
        "dotenv" => LanguageDefinition {
            display_name: "Dotenv",
            syntax_names: &["DotENV", "dotenv"],
            syntax_tokens: &["dotenv", "env"],
        },
        "dockerfile" => LanguageDefinition {
            display_name: "Dockerfile",
            syntax_names: &["Dockerfile"],
            syntax_tokens: &["dockerfile"],
        },
        "graphql" | "gql" => LanguageDefinition {
            display_name: "GraphQL",
            syntax_names: &["GraphQL"],
            syntax_tokens: &["graphql", "gql"],
        },
        "text" | "txt" | "plain" | "plaintext" => LanguageDefinition {
            display_name: "Text",
            syntax_names: &["Plain Text"],
            syntax_tokens: &["txt", "text"],
        },
        _ => return None,
    };

    Some(definition)
}

fn highlight_code(code: &str, language: &LanguageDefinition) -> Option<String> {
    let syntax_set = syntax_set();
    let syntax = find_syntax(syntax_set, language)?;
    let mut generator = ClassedHTMLGenerator::new_with_class_style(
        syntax,
        syntax_set,
        ClassStyle::SpacedPrefixed { prefix: "syn-" },
    );

    for line in LinesWithEndings::from(code) {
        generator
            .parse_html_for_line_which_includes_newline(line)
            .ok()?;
    }

    Some(generator.finalize())
}

fn syntax_set() -> &'static SyntaxSet {
    static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAX_SET.get_or_init(two_face::syntax::extra_newlines)
}

fn find_syntax<'a>(
    syntax_set: &'a SyntaxSet,
    language: &LanguageDefinition,
) -> Option<&'a SyntaxReference> {
    language
        .syntax_names
        .iter()
        .find_map(|name| syntax_set.find_syntax_by_name(name))
        .or_else(|| {
            language
                .syntax_tokens
                .iter()
                .find_map(|token| syntax_set.find_syntax_by_token(token))
        })
}

fn safe_css_identifier(value: &str) -> String {
    value
        .chars()
        .filter_map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' {
                Some(char.to_ascii_lowercase())
            } else {
                None
            }
        })
        .collect::<String>()
}

fn repository_context(start: &Path) -> Option<RepositoryContext> {
    let mut current = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };

    loop {
        let git = current.join(".git");
        if git.exists() {
            return repository_context_from_git(&git);
        }

        if !current.pop() {
            return None;
        }
    }
}

fn repository_context_from_git(git_path: &Path) -> Option<RepositoryContext> {
    let config_paths = if git_path.is_file() {
        let git_file = fs::read_to_string(git_path).ok()?;
        let git_dir = git_file.trim().strip_prefix("gitdir:")?.trim();
        let git_dir = PathBuf::from(git_dir);
        let mut paths = vec![git_dir.join("config")];
        if let Ok(commondir) = fs::read_to_string(git_dir.join("commondir")) {
            let commondir = commondir.trim();
            let common_path = if Path::new(commondir).is_absolute() {
                PathBuf::from(commondir)
            } else {
                git_dir.join(commondir)
            };
            paths.push(common_path.join("config"));
        }
        paths
    } else {
        vec![git_path.join("config")]
    };

    config_paths.into_iter().find_map(|config_path| {
        let config = fs::read_to_string(config_path).ok()?;
        config
            .lines()
            .find_map(|line| line.trim().strip_prefix("url = "))
            .and_then(repository_context_from_remote_url)
    })
}

fn repository_context_from_remote_url(url: &str) -> Option<RepositoryContext> {
    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))?;
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    (!owner.is_empty() && !repo.is_empty()).then_some(RepositoryContext { owner, repo })
}

fn append_autolink_events(text: &str, finder: &LinkFinder, events: &mut Vec<Event<'static>>) {
    let mut offset = 0;

    for link in finder.links(text) {
        if link.start() > offset {
            events.push(Event::Text(cowstr(&text[offset..link.start()])));
        }

        let link_text = link.as_str();
        if let Some(destination) = autolink_destination(link_text, link.kind()) {
            events.push(Event::Start(Tag::Link {
                link_type: LinkType::Autolink,
                dest_url: cowstr(&destination),
                title: CowStr::Borrowed(""),
                id: CowStr::Borrowed(""),
            }));
            events.push(Event::Text(cowstr(link_text)));
            events.push(Event::End(TagEnd::Link));
        } else {
            events.push(Event::Text(cowstr(link_text)));
        }

        offset = link.end();
    }

    if offset < text.len() {
        events.push(Event::Text(cowstr(&text[offset..])));
    }
}

fn autolink_destination(text: &str, kind: &LinkKind) -> Option<String> {
    match kind {
        LinkKind::Email => Some(format!("mailto:{text}")),
        LinkKind::Url if starts_with_url_scheme(text) => Some(text.to_string()),
        LinkKind::Url if text.starts_with("www.") => Some(format!("http://{text}")),
        _ => None,
    }
}

fn starts_with_url_scheme(text: &str) -> bool {
    text.starts_with("http://") || text.starts_with("https://")
}

fn resolve_absolute_markdown_image_urls(
    events: Vec<Event<'static>>,
    source_path: &Path,
) -> Vec<Event<'static>> {
    events
        .into_iter()
        .map(|event| match event {
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) => {
                let resolved = markdown_image_destination_for_html(dest_url.as_ref(), source_path)
                    .map_or(dest_url, |url| cowstr(&url));

                Event::Start(Tag::Image {
                    link_type,
                    dest_url: resolved,
                    title,
                    id,
                })
            }
            _ => event,
        })
        .collect()
}

/// Copy an image's alt text into its `title` attribute when no explicit title
/// is set, so hovering the image shows the alt text as a native tooltip.
fn fill_image_titles_from_alt(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut transformed: Vec<Event<'static>> = Vec::with_capacity(events.len());

    for (index, event) in events.iter().enumerate() {
        match event {
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) if title.is_empty() => {
                let alt = collect_image_alt_text(&events[index + 1..]);
                transformed.push(Event::Start(Tag::Image {
                    link_type: *link_type,
                    dest_url: dest_url.clone(),
                    title: cowstr(&alt),
                    id: id.clone(),
                }));
            }
            _ => transformed.push(event.clone()),
        }
    }

    transformed
}

/// Gather the plain text inside an image (its alt text) up to the closing image
/// tag. `events` starts just after the image's start tag.
fn collect_image_alt_text(events: &[Event<'static>]) -> String {
    let mut alt = String::new();

    for event in events {
        match event {
            Event::End(TagEnd::Image) => break,
            Event::Text(text) | Event::Code(text) => alt.push_str(text),
            _ => {}
        }
    }

    alt
}

fn markdown_image_destination_for_html(destination: &str, source_path: &Path) -> Option<String> {
    if let Some(badge_url) = github_actions_badge_fallback_url(destination) {
        return Some(badge_url);
    }

    let source_dir = local_image_source_dir(source_path)?;

    if Path::new(destination).is_absolute() {
        return local_image_relative_url_for_path(Path::new(destination), &source_dir);
    }

    if let Ok(url) = Url::parse(destination) {
        if url.scheme() == "file" {
            return url
                .to_file_path()
                .ok()
                .and_then(|path| local_image_relative_url_for_path(&path, &source_dir));
        }
    }

    None
}

fn github_actions_badge_fallback_url(destination: &str) -> Option<String> {
    let url = Url::parse(destination).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str() != Some("github.com") {
        return None;
    }

    let segments: Vec<&str> = url.path_segments()?.collect();
    let [owner, repo, "actions", "workflows", workflow, "badge.svg"] = segments.as_slice() else {
        return None;
    };

    let mut fallback = Url::parse("https://img.shields.io").ok()?;
    fallback.path_segments_mut().ok()?.extend([
        "github", "actions", "workflow", "status", owner, repo, workflow,
    ]);

    {
        let mut query = fallback.query_pairs_mut();
        query.append_pair("label", &github_actions_badge_label(workflow));
    }

    Some(fallback.to_string())
}

fn github_actions_badge_label(workflow: &str) -> String {
    let stem = workflow
        .strip_suffix(".yml")
        .or_else(|| workflow.strip_suffix(".yaml"))
        .unwrap_or(workflow);

    stem.split(['-', '_', '.'])
        .filter(|word| !word.is_empty())
        .map(|word| match word.to_ascii_lowercase().as_str() {
            "ci" => "CI".to_string(),
            "qemu" => "QEMU".to_string(),
            _ => {
                let mut chars = word.chars();
                chars
                    .next()
                    .map(|first| {
                        first
                            .to_uppercase()
                            .chain(chars.flat_map(char::to_lowercase))
                            .collect()
                    })
                    .unwrap_or_default()
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

fn resolve_image_destination(destination: &str, source_path: &Path) -> Option<String> {
    if destination.is_empty() || destination.starts_with('#') || destination.starts_with("//") {
        return None;
    }

    if let Ok(url) = Url::parse(destination) {
        return match url.scheme() {
            "http" | "https" => Some(url.to_string()),
            "file" => url
                .to_file_path()
                .ok()
                .zip(local_image_source_dir(source_path))
                .and_then(|(path, source_dir)| {
                    local_image_protocol_url_for_path(&path, &source_dir)
                }),
            _ => None,
        };
    }

    let source_dir = local_image_source_dir(source_path)?;

    if Path::new(destination).is_absolute() {
        return local_image_protocol_url_for_path(Path::new(destination), &source_dir);
    }

    local_image_protocol_url_for_relative_destination(destination, &source_dir)
}

fn is_safe_relative_image_destination(destination: &str) -> bool {
    if destination.is_empty() || destination.starts_with('#') || destination.starts_with("//") {
        return false;
    }

    matches!(
        Url::parse(destination),
        Err(url::ParseError::RelativeUrlWithoutBase)
    )
}

pub fn local_image_source_dir(source_path: &Path) -> Option<PathBuf> {
    source_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(normalize_path_lexically)
}

fn local_image_protocol_url_for_relative_destination(
    destination: &str,
    source_dir: &Path,
) -> Option<String> {
    let path = local_image_destination_path(destination)?;
    if path.is_absolute() {
        return local_image_protocol_url_for_path(&path, source_dir);
    }

    local_image_protocol_url_for_relative_path(&path, source_dir)
}

fn local_image_destination_path(destination: &str) -> Option<PathBuf> {
    let path = destination.split(['#', '?']).next().unwrap_or(destination);
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(percent_decode_path(path)))
}

fn local_image_protocol_url_for_path(path: &Path, source_dir: &Path) -> Option<String> {
    let normalized_path = normalize_path_lexically(path);
    let normalized_source_dir = normalize_path_lexically(source_dir);
    let relative = normalized_path.strip_prefix(&normalized_source_dir).ok()?;

    local_image_protocol_url_for_relative_path(relative, &normalized_source_dir)
}

fn local_image_relative_url_for_path(path: &Path, source_dir: &Path) -> Option<String> {
    let normalized_path = normalize_path_lexically(path);
    let normalized_source_dir = normalize_path_lexically(source_dir);
    let relative = normalized_path.strip_prefix(&normalized_source_dir).ok()?;

    local_image_relative_url(relative)
}

fn local_image_protocol_url_for_relative_path(
    relative_path: &Path,
    _source_dir: &Path,
) -> Option<String> {
    let mut segments = Vec::new();

    for component in relative_path.components() {
        match component {
            std::path::Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.is_empty() {
                    return None;
                }
                segments.push(percent_encode_url_path_segment(&segment));
            }
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                segments.push(LOCAL_IMAGE_PARENT_SEGMENT.to_string())
            }
            _ => return None,
        }
    }

    (!segments.is_empty()).then(|| local_image_webview_url(&segments.join("/")))
}

fn local_image_relative_url(relative_path: &Path) -> Option<String> {
    let relative_path = normalize_path_lexically(relative_path);
    let mut segments = Vec::new();

    for component in relative_path.components() {
        match component {
            std::path::Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.is_empty() {
                    return None;
                }
                segments.push(percent_encode_url_path_segment(&segment));
            }
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }

    (!segments.is_empty()).then(|| segments.join("/"))
}

pub fn local_image_protocol_response(uri: &str, source_dir: Option<&Path>) -> LocalImageResponse {
    let Some(source_dir) = source_dir else {
        return empty_local_image_response(404);
    };
    let Some(path) = local_image_protocol_path(uri, source_dir) else {
        return empty_local_image_response(404);
    };
    if !local_image_path_is_in_source_dir(&path, source_dir) {
        return empty_local_image_response(403);
    }

    match fs::read(&path) {
        Ok(body) => LocalImageResponse {
            status: 200,
            content_type: local_image_mime_type(&path),
            body,
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => empty_local_image_response(404),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            empty_local_image_response(403)
        }
        Err(_) => empty_local_image_response(500),
    }
}

fn local_image_protocol_path(uri: &str, source_dir: &Path) -> Option<PathBuf> {
    let url = Url::parse(uri).ok()?;
    if !is_local_image_request_url(&url) {
        return None;
    }

    let mut relative = PathBuf::new();
    for segment in url.path_segments()? {
        if segment.is_empty() {
            continue;
        }
        let decoded = percent_decode_path(segment);
        if decoded == LOCAL_IMAGE_PARENT_SEGMENT {
            relative.push("..");
            continue;
        }
        if decoded.is_empty() || decoded == "." || decoded == ".." {
            return None;
        }
        relative.push(decoded);
    }
    if relative.as_os_str().is_empty() {
        return None;
    }

    Some(normalize_path_lexically(&source_dir.join(relative)))
}

fn is_local_image_request_url(url: &Url) -> bool {
    if url.scheme() == LOCAL_IMAGE_PROTOCOL {
        return url.host_str() == Some(LOCAL_IMAGE_HOST);
    }

    matches!(url.scheme(), "http" | "https")
        && url
            .host_str()
            .and_then(|host| host.strip_prefix(&format!("{LOCAL_IMAGE_PROTOCOL}.")))
            == Some(LOCAL_IMAGE_HOST)
}

fn local_image_path_is_in_source_dir(path: &Path, source_dir: &Path) -> bool {
    let normalized_path = normalize_path_lexically(path);
    let normalized_access_root = local_image_access_root(source_dir);
    if !normalized_path.starts_with(&normalized_access_root) {
        return false;
    }

    match (
        fs::canonicalize(&normalized_path),
        fs::canonicalize(&normalized_access_root),
    ) {
        (Ok(canonical_path), Ok(canonical_access_root)) => {
            canonical_path.starts_with(canonical_access_root)
        }
        _ => true,
    }
}

fn local_image_access_root(source_dir: &Path) -> PathBuf {
    normalize_path_lexically(
        source_dir
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or(source_dir),
    )
}

fn local_image_webview_url(path: &str) -> String {
    let protocol_url = format!("{LOCAL_IMAGE_PROTOCOL}://{LOCAL_IMAGE_HOST}/{path}");
    local_image_webview_url_from_protocol_url(&protocol_url)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn local_image_webview_url_from_protocol_url(url: &str) -> String {
    url.replacen(
        &format!("{LOCAL_IMAGE_PROTOCOL}://"),
        &format!("http://{LOCAL_IMAGE_PROTOCOL}."),
        1,
    )
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
fn local_image_webview_url_from_protocol_url(url: &str) -> String {
    url.to_string()
}

fn empty_local_image_response(status: u16) -> LocalImageResponse {
    LocalImageResponse {
        status,
        content_type: "text/plain; charset=utf-8",
        body: Vec::new(),
    }
}

fn local_image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("apng") => "image/apng",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn percent_encode_url_path_segment(segment: &str) -> String {
    if segment == "." {
        return "%2E".to_string();
    }
    if segment == ".." {
        return "%2E%2E".to_string();
    }

    let mut encoded = String::with_capacity(segment.len());
    for byte in segment.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn percent_decode_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(value) = hex_pair(bytes[index + 1], bytes[index + 2]) {
                decoded.push(value);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8(decoded)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
}

fn hex_pair(high: u8, low: u8) -> Option<u8> {
    Some(hex_value(high)? << 4 | hex_value(low)?)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn resolve_rendered_html_image_urls(html: &str, source_path: &Path) -> String {
    let mut resolved = String::with_capacity(html.len());
    let mut offset = 0usize;
    let lower_html = html.to_ascii_lowercase();

    while let Some(relative_start) = lower_html[offset..].find("<img") {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            break;
        };

        resolved.push_str(&html[offset..tag_start]);
        resolved.push_str(&resolve_img_tag_src(&html[tag_start..tag_end], source_path));
        offset = tag_end;
    }

    resolved.push_str(&html[offset..]);
    resolved
}

fn sanitize_raw_markdown_html_fragment(html: &str) -> String {
    let mut sanitized = String::with_capacity(html.len());
    let mut offset = 0usize;
    let lower_html = html.to_ascii_lowercase();

    while let Some(relative_start) = html[offset..].find('<') {
        let tag_start = offset + relative_start;
        sanitized.push_str(&html[offset..tag_start]);

        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            sanitized.push_str(&encode_text(&html[tag_start..]));
            return sanitized;
        };

        let tag = &html[tag_start..tag_end];
        if let Some(tag_name) = html_tag_name(tag) {
            if matches!(tag_name.as_str(), "script" | "style") && !is_html_closing_tag(tag) {
                if let Some(close_start) = lower_html[tag_end..].find(&format!("</{tag_name}")) {
                    if let Some(close_end) = find_html_tag_end(html, tag_end + close_start) {
                        offset = close_end;
                        continue;
                    }
                }
                return sanitized;
            }
        }

        sanitized.push_str(&sanitize_raw_markdown_html_tag(tag));
        offset = tag_end;
    }

    sanitized.push_str(&html[offset..]);
    sanitized
}

fn opens_unclosed_raw_html_content_tag(html: &str) -> Option<&'static str> {
    ["script", "style"].into_iter().find(|tag_name| {
        opens_raw_html_content_tag(html, tag_name) && !closes_raw_html_content_tag(html, tag_name)
    })
}

fn opens_raw_html_content_tag(html: &str, tag_name: &str) -> bool {
    let lower_html = html.to_ascii_lowercase();
    let mut offset = 0usize;
    while let Some(relative_start) = lower_html[offset..].find(&format!("<{tag_name}")) {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            return true;
        };
        if html_tag_name(&html[tag_start..tag_end]).as_deref() == Some(tag_name) {
            return true;
        }
        offset = tag_end;
    }
    false
}

fn closes_raw_html_content_tag(html: &str, tag_name: &str) -> bool {
    let lower_html = html.to_ascii_lowercase();
    let mut offset = 0usize;
    while let Some(relative_start) = lower_html[offset..].find(&format!("</{tag_name}")) {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            return true;
        };
        if html_tag_name(&html[tag_start..tag_end]).as_deref() == Some(tag_name) {
            return true;
        }
        offset = tag_end;
    }
    false
}

fn sanitize_raw_markdown_html_tag(tag: &str) -> String {
    let Some(tag_name) = html_tag_name(tag) else {
        return String::new();
    };

    if !is_allowed_raw_markdown_html_tag(&tag_name) {
        return String::new();
    }

    if is_html_closing_tag(tag) {
        return format!("</{tag_name}>");
    }

    let mut sanitized = String::from("<");
    sanitized.push_str(&tag_name);

    for attribute_name in allowed_raw_markdown_html_attributes(&tag_name) {
        let Some(attribute) = find_html_attribute(tag, attribute_name) else {
            continue;
        };
        let Some(attribute_value) =
            sanitized_raw_markdown_html_attribute_value(attribute_name, attribute.value)
        else {
            continue;
        };
        sanitized.push(' ');
        sanitized.push_str(attribute_name);
        sanitized.push_str("=\"");
        sanitized.push_str(&encode_double_quoted_attribute(&attribute_value));
        sanitized.push('"');
    }

    // Boolean attributes (e.g. `<details open>`) carry no value; emit them bare
    // when present so a collapsible block keeps its expanded state.
    for attribute_name in allowed_raw_markdown_html_boolean_attributes(&tag_name) {
        if html_has_boolean_attribute(tag, attribute_name) {
            sanitized.push(' ');
            sanitized.push_str(attribute_name);
        }
    }

    if is_html_self_closing_tag(tag) {
        sanitized.push_str(" />");
    } else {
        sanitized.push('>');
    }

    sanitized
}

fn html_tag_name(tag: &str) -> Option<String> {
    let mut index = 1usize;
    if tag.as_bytes().get(index).copied() == Some(b'/') {
        index += 1;
    }
    index = skip_html_whitespace(tag, index);
    let name_start = index;
    while index < tag.len() {
        let character = tag[index..].chars().next()?;
        if !(character.is_ascii_alphanumeric() || matches!(character, '-' | ':')) {
            break;
        }
        index += character.len_utf8();
    }
    (index > name_start).then(|| tag[name_start..index].to_ascii_lowercase())
}

fn is_html_closing_tag(tag: &str) -> bool {
    tag[1..].trim_start().starts_with('/')
}

fn is_html_self_closing_tag(tag: &str) -> bool {
    tag[..tag.len().saturating_sub(1)].trim_end().ends_with('/')
}

fn is_allowed_raw_markdown_html_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "p" | "br"
            | "hr"
            | "a"
            | "strong"
            | "em"
            | "del"
            | "code"
            | "pre"
            | "img"
            | "ul"
            | "ol"
            | "li"
            | "blockquote"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "div"
            | "span"
            | "table"
            | "thead"
            | "tbody"
            | "tr"
            | "td"
            | "th"
            // Collapsible sections: `<details>`/`<summary>`, common in GitHub READMEs.
            | "details"
            | "summary"
            // Safe semantic/formatting inline elements (no scripting, no resource
            // loads). The document body already styles `kbd`/`summary`/`figcaption`.
            | "kbd"
            | "sub"
            | "sup"
            | "mark"
            | "ins"
            | "s"
            | "abbr"
            | "dl"
            | "dt"
            | "dd"
            | "figure"
            | "figcaption"
    )
}

fn allowed_raw_markdown_html_attributes(tag_name: &str) -> &'static [&'static str] {
    match tag_name {
        "a" => &["href", "title", "id", "name"],
        "img" => &["src", "alt", "title"],
        "div" | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => &["align", "id"],
        "span" => &["id"],
        "td" | "th" => &["align", "colspan"],
        // `title` is the abbr tooltip. `<details>`'s `open` is a boolean attribute,
        // handled by `allowed_raw_markdown_html_boolean_attributes`.
        "abbr" => &["title"],
        _ => &[],
    }
}

/// Valueless (boolean) attributes kept on a tag when present, such as `open` on
/// `<details>`. Their mere presence is the value, so they are emitted bare.
fn allowed_raw_markdown_html_boolean_attributes(tag_name: &str) -> &'static [&'static str] {
    match tag_name {
        "details" => &["open"],
        _ => &[],
    }
}

/// Whether `tag` carries `attribute_name` as an attribute, with or without a
/// value (`open`, `open=""`, and `open="open"` all count). Uses the same
/// attribute tokenization as [`find_html_attribute`] so a substring inside another
/// attribute's value (e.g. `title="open sesame"`) does not false-positive.
fn html_has_boolean_attribute(tag: &str, attribute_name: &str) -> bool {
    let mut index = tag.find(char::is_whitespace).unwrap_or(tag.len());

    while index < tag.len() {
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() || tag[index..].starts_with('>') || tag[index..].starts_with("/>") {
            break;
        }

        let name_start = index;
        while index < tag.len() {
            let Some(character) = tag[index..].chars().next() else {
                break;
            };
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.') {
                index += character.len_utf8();
            } else {
                break;
            }
        }
        if name_start == index {
            let Some(character) = tag[index..].chars().next() else {
                break;
            };
            index += character.len_utf8();
            continue;
        }
        let name = &tag[name_start..index];
        index = skip_html_whitespace(tag, index);

        // Skip an `="value"` (or unquoted value) so the scan stays aligned on the
        // next attribute name; presence of the name is what matters here.
        if tag[index..].starts_with('=') {
            index += 1;
            index = skip_html_whitespace(tag, index);
            if let Some(first) = tag[index..].chars().next() {
                if first == '"' || first == '\'' {
                    index += first.len_utf8();
                    while index < tag.len() {
                        let Some(character) = tag[index..].chars().next() else {
                            break;
                        };
                        index += character.len_utf8();
                        if character == first {
                            break;
                        }
                    }
                } else {
                    while index < tag.len() {
                        let Some(character) = tag[index..].chars().next() else {
                            break;
                        };
                        if character.is_whitespace() || character == '>' {
                            break;
                        }
                        index += character.len_utf8();
                    }
                }
            }
        }

        if name.eq_ignore_ascii_case(attribute_name) {
            return true;
        }
    }

    false
}

fn sanitized_raw_markdown_html_attribute_value(
    attribute_name: &str,
    value: &str,
) -> Option<String> {
    match attribute_name {
        "href" | "src" => is_safe_raw_markdown_html_url(value).then(|| value.to_string()),
        "align" => sanitize_raw_markdown_html_align_value(value),
        _ => Some(value.to_string()),
    }
}

fn sanitize_raw_markdown_html_align_value(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    matches!(normalized.as_str(), "left" | "center" | "right" | "justify").then_some(normalized)
}

fn is_safe_raw_markdown_html_url(value: &str) -> bool {
    match Url::parse(value) {
        Ok(url) => matches!(url.scheme(), "http" | "https" | "mailto" | "file"),
        Err(url::ParseError::RelativeUrlWithoutBase) => true,
        Err(_) => false,
    }
}

fn find_html_tag_end(html: &str, tag_start: usize) -> Option<usize> {
    let mut quote = None;

    for (relative_index, character) in html[tag_start..].char_indices() {
        match (quote, character) {
            (Some(active_quote), current) if current == active_quote => quote = None,
            (None, '"' | '\'') => quote = Some(character),
            (None, '>') => return Some(tag_start + relative_index + character.len_utf8()),
            _ => {}
        }
    }

    None
}

fn resolve_img_tag_src(tag: &str, source_path: &Path) -> String {
    let Some(attribute) = find_html_attribute(tag, "src") else {
        return tag.to_string();
    };
    if local_image_source_dir(source_path).is_none()
        && is_safe_relative_image_destination(attribute.value)
    {
        return tag.to_string();
    }
    let resolved_src = resolve_image_destination(attribute.value, source_path)
        .unwrap_or_else(|| "javascript:leaf-blocked".to_string());

    let mut resolved = String::with_capacity(tag.len() + resolved_src.len());
    resolved.push_str(&tag[..attribute.replacement_start]);
    if attribute.was_quoted {
        resolved.push_str(&encode_double_quoted_attribute(&resolved_src));
    } else {
        resolved.push('"');
        resolved.push_str(&encode_double_quoted_attribute(&resolved_src));
        resolved.push('"');
    }
    resolved.push_str(&tag[attribute.replacement_end..]);
    resolved
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HtmlAttribute<'a> {
    value: &'a str,
    replacement_start: usize,
    replacement_end: usize,
    was_quoted: bool,
}

fn find_html_attribute<'a>(tag: &'a str, attribute_name: &str) -> Option<HtmlAttribute<'a>> {
    let mut index = tag.find(char::is_whitespace).unwrap_or(tag.len());

    while index < tag.len() {
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() || tag[index..].starts_with('>') || tag[index..].starts_with("/>") {
            break;
        }

        let name_start = index;
        while index < tag.len() {
            let character = tag[index..].chars().next()?;
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.') {
                index += character.len_utf8();
            } else {
                break;
            }
        }
        if name_start == index {
            index += tag[index..].chars().next()?.len_utf8();
            continue;
        }
        let name = &tag[name_start..index];
        index = skip_html_whitespace(tag, index);

        if !tag[index..].starts_with('=') {
            continue;
        }

        index += 1;
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() {
            break;
        }

        let value_start;
        let value_end;
        let was_quoted;
        let first = tag[index..].chars().next()?;
        if first == '"' || first == '\'' {
            was_quoted = true;
            index += first.len_utf8();
            value_start = index;
            while index < tag.len() {
                let character = tag[index..].chars().next()?;
                if character == first {
                    break;
                }
                index += character.len_utf8();
            }
            value_end = index;
            if index < tag.len() {
                index += first.len_utf8();
            }
        } else {
            was_quoted = false;
            value_start = index;
            while index < tag.len() {
                let character = tag[index..].chars().next()?;
                if character.is_whitespace() || character == '>' {
                    break;
                }
                index += character.len_utf8();
            }
            value_end = index;
        }

        if name.eq_ignore_ascii_case(attribute_name) {
            return Some(HtmlAttribute {
                value: &tag[value_start..value_end],
                replacement_start: value_start,
                replacement_end: value_end,
                was_quoted,
            });
        }
    }

    None
}

fn skip_html_whitespace(text: &str, mut index: usize) -> usize {
    while index < text.len() {
        let Some(character) = text[index..].chars().next() else {
            break;
        };
        if !character.is_whitespace() {
            break;
        }
        index += character.len_utf8();
    }
    index
}

fn cowstr(value: &str) -> CowStr<'static> {
    CowStr::Boxed(value.to_string().into_boxed_str())
}

fn sanitize_rendered_html(html: &str) -> String {
    let mut sanitizer = Builder::new();
    configure_rendered_html_sanitizer(&mut sanitizer);
    sanitizer.clean(html).to_string()
}

fn configure_rendered_html_sanitizer(sanitizer: &mut Builder<'_>) {
    sanitizer
        .url_schemes(
            ["http", "https", "mailto", "glossary", LOCAL_IMAGE_PROTOCOL]
                .into_iter()
                .collect(),
        )
        .add_tags(&["input"])
        .add_tag_attributes("a", &["aria-label", "class", "id", "name"])
        .add_tag_attributes("blockquote", &["class"])
        .add_tag_attributes("div", &["align", "class", "id"])
        .add_tag_attributes("code", &["class"])
        .add_tag_attributes("abbr", &["title"])
        .add_tag_attributes("details", &["open"])
        .add_tag_attributes("h1", &["align", "id"])
        .add_tag_attributes("h2", &["align", "id"])
        .add_tag_attributes("h3", &["align", "id"])
        .add_tag_attributes("h4", &["align", "id"])
        .add_tag_attributes("h5", &["align", "id"])
        .add_tag_attributes("h6", &["align", "id"])
        .add_tag_attributes("img", &["alt", "src", "title"])
        .add_tag_attributes("p", &["align", "id"])
        .add_tag_attributes("pre", &["class", "data-language"])
        .add_tag_attributes("span", &["aria-label", "class", "id", "title"])
        .add_tag_attributes("sup", &["class", "id"])
        .add_tags(&["svg", "path"])
        .add_tag_attributes("svg", &["aria-hidden", "focusable", "viewBox", "xmlns"])
        .add_tag_attributes(
            "path",
            &[
                "d",
                "fill",
                "stroke",
                "stroke-linecap",
                "stroke-linejoin",
                "stroke-width",
            ],
        )
        .add_tag_attributes("input", &["checked", "disabled", "type"])
        .add_tag_attributes("td", &["align", "colspan"])
        .add_tag_attributes("th", &["align", "colspan"]);
}

fn markdown_title(markdown: &str) -> Option<String> {
    let events = parse_markdown_source(markdown, MarkdownParserConfig::github_flavored());
    markdown_heading_title(&events).or_else(|| raw_html_block_title(&events))
}

fn markdown_heading_title(events: &[Event<'static>]) -> Option<String> {
    let mut heading_text = String::new();
    let mut in_heading = false;

    for event in events {
        match event {
            Event::Start(Tag::Heading { .. }) => {
                in_heading = true;
                heading_text.clear();
            }
            Event::End(TagEnd::Heading(_)) if in_heading => {
                if let Some(title) = plain_document_title(&heading_text) {
                    return Some(title);
                }
                in_heading = false;
            }
            _ if in_heading => append_title_text(event, &mut heading_text),
            _ => {}
        }
    }

    None
}

fn raw_html_block_title(events: &[Event<'static>]) -> Option<String> {
    events.iter().find_map(|event| {
        if let Event::Html(html) | Event::InlineHtml(html) = event {
            plain_document_title_from_html(html.as_ref())
        } else {
            None
        }
    })
}

fn append_title_text(event: &Event<'_>, text: &mut String) {
    match event {
        Event::Text(value) | Event::Code(value) => text.push_str(value.as_ref()),
        Event::InlineHtml(value) | Event::Html(value) => {
            text.push_str(&strip_html_tags(value.as_ref()));
        }
        Event::SoftBreak | Event::HardBreak => text.push(' '),
        _ => {}
    }
}

fn plain_document_title_from_html(value: &str) -> Option<String> {
    let stripped = strip_html_tags(value);
    plain_document_title(&stripped)
}

fn plain_document_title(value: &str) -> Option<String> {
    let decoded = decode_html_entities(value);
    let normalized = normalize_title_whitespace(decoded.as_ref());
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_title_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Debug, Clone, Copy)]
struct MinimapFence {
    marker: char,
    length: usize,
}

fn minimap_line_category(
    lines: &[&str],
    line_index: usize,
    fence: &mut Option<MinimapFence>,
) -> MinimapLineCategory {
    let line = lines[line_index];

    if let Some(open_fence) = fence {
        let category = MinimapLineCategory::CodeFence;
        if minimap_closes_fence(line, *open_fence) {
            *fence = None;
        }
        return category;
    }

    if line.trim().is_empty() {
        return MinimapLineCategory::Blank;
    }

    if let Some(open_fence) = minimap_opening_fence(line) {
        *fence = Some(open_fence);
        return MinimapLineCategory::CodeFence;
    }

    let trimmed_start = line.trim_start();
    if trimmed_start.starts_with('>') {
        return MinimapLineCategory::Blockquote;
    }

    if minimap_is_atx_heading(trimmed_start)
        || minimap_is_setext_heading_line(lines, line_index)
        || minimap_is_setext_underline_line(lines, line_index)
    {
        return MinimapLineCategory::Heading;
    }

    if minimap_is_list_item(trimmed_start) {
        return MinimapLineCategory::List;
    }

    MinimapLineCategory::Paragraph
}

fn minimap_line_structure(line: &str) -> MinimapLineStructure {
    if line.trim().chars().count() >= MINIMAP_LONG_LINE_CHAR_THRESHOLD {
        MinimapLineStructure::Long
    } else {
        MinimapLineStructure::Short
    }
}

fn minimap_opening_fence(line: &str) -> Option<MinimapFence> {
    let trimmed = minimap_trim_leading_up_to_three_spaces(line)?;
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }

    let length = trimmed
        .chars()
        .take_while(|character| *character == marker)
        .count();
    (length >= 3).then_some(MinimapFence { marker, length })
}

fn minimap_closes_fence(line: &str, fence: MinimapFence) -> bool {
    let Some(trimmed) = minimap_trim_leading_up_to_three_spaces(line) else {
        return false;
    };
    let length = trimmed
        .chars()
        .take_while(|character| *character == fence.marker)
        .count();
    length >= fence.length
        && trimmed[length..]
            .chars()
            .all(|character| character.is_whitespace())
}

fn minimap_trim_leading_up_to_three_spaces(line: &str) -> Option<&str> {
    let space_count = line
        .chars()
        .take_while(|character| *character == ' ')
        .count();
    (space_count <= 3).then_some(&line[space_count..])
}

fn minimap_is_atx_heading(trimmed_start: &str) -> bool {
    let marker_count = trimmed_start
        .chars()
        .take_while(|character| *character == '#')
        .count();

    (1..=6).contains(&marker_count)
        && trimmed_start[marker_count..]
            .chars()
            .next()
            .is_none_or(char::is_whitespace)
}

fn minimap_is_setext_heading_line(lines: &[&str], line_index: usize) -> bool {
    if lines[line_index].trim().is_empty() || line_index + 1 >= lines.len() {
        return false;
    }

    minimap_is_setext_underline(lines[line_index + 1].trim_start())
}

fn minimap_is_setext_underline_line(lines: &[&str], line_index: usize) -> bool {
    line_index > 0
        && !lines[line_index - 1].trim().is_empty()
        && minimap_is_setext_underline(lines[line_index].trim_start())
}

fn minimap_is_setext_underline(trimmed_start: &str) -> bool {
    let trimmed = trimmed_start.trim_end();
    let Some(marker) = trimmed.chars().next() else {
        return false;
    };
    (marker == '=' || marker == '-') && trimmed.chars().all(|character| character == marker)
}

fn minimap_is_list_item(trimmed_start: &str) -> bool {
    if let Some(rest) = trimmed_start
        .strip_prefix("- ")
        .or_else(|| trimmed_start.strip_prefix("+ "))
        .or_else(|| trimmed_start.strip_prefix("* "))
    {
        return !rest.is_empty();
    }

    let digit_count = trimmed_start
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count();
    if digit_count == 0 || digit_count > 9 {
        return false;
    }

    let rest = &trimmed_start[digit_count..];
    rest.strip_prefix(". ")
        .or_else(|| rest.strip_prefix(") "))
        .is_some_and(|item| !item.is_empty())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ThemeSourceKind {
    Primer,
    Dracula,
}

#[derive(Debug, Clone, Copy)]
struct ThemeSource {
    id: &'static str,
    display_name: &'static str,
    selector: &'static str,
    kind: ThemeSourceKind,
    selectable: bool,
    tokens: &'static [(&'static str, &'static str)],
    /// Per-source token replacements layered on top of `tokens`, used to nudge a
    /// single palette without forking the whole shared token map. A token listed
    /// here wins over the same token in `tokens`.
    overrides: &'static [(&'static str, &'static str)],
}

const LEAF_SEMANTIC_TOKEN_CONTRACT: &[&str] = &[
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

const PRIMER_THEME_TOKENS: &[(&str, &str)] = &[
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
    (
        "--leaf-minimap-heading",
        "var(--button-primary-bgColor-rest)",
    ),
    ("--leaf-minimap-paragraph", "var(--fgColor-muted)"),
    ("--leaf-minimap-blank", "var(--borderColor-default)"),
    ("--leaf-minimap-list", "var(--fgColor-success)"),
    ("--leaf-minimap-blockquote", "var(--fgColor-accent)"),
    ("--leaf-minimap-code", "var(--fgColor-done)"),
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

const DRACULA_THEME_TOKENS: &[(&str, &str)] = &[
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

// Primer Dark borrows GitHub's neutral grey borders (#3d444d / #656c76), which
// read as flat grey against the near-black page — the window border, the title
// bar tinted off it, and the document rules all look colorless. Shift the whole
// border family to a desaturated slate blue at the same lightness so the chrome
// reads as a cool, deliberate frame rather than grey. Light and Dracula keep
// their own borders. Slate (#39435f) replaces --borderColor-default, a lighter
// slate (#5b6788) replaces --borderColor-emphasis, and the muted rule keeps its
// translucency (#39435fb3).
const PRIMER_DARK_BORDER_OVERRIDES: &[(&str, &str)] = &[
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

fn theme_sources() -> &'static [ThemeSource] {
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

fn compiled_theme_css() -> String {
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

fn assert_theme_sources_cover_contract(sources: &[ThemeSource]) {
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
        // Dracula-kind palettes ship a complete token set and must activate
        // through their own source attribute, never the shared Primer
        // color-mode selectors that depend on the Primer primitive cascade.
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

fn theme_source_token_value(source: &ThemeSource, token: &str) -> Option<&'static str> {
    source
        .overrides
        .iter()
        .chain(source.tokens.iter())
        .find_map(|(name, value)| (*name == token).then_some(*value))
}

fn reading_mode_css() -> &'static str {
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
  /* No resting fill — the container stays flat like the other icon buttons. The
     icon is dimmed at rest so it reads as a quiet, secondary control, then lights
     up to the green action treatment on hover. */
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
/* The Open action should rest in the same muted state as the other secondary
   toolbar icons, then switch to the green action treatment on hover. */
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
  /* Positioning context for the open-library button, which is pinned to the
     shell's left edge so it stays reachable when the pane column collapses to 0. */
  position: relative;
}
.library-shell.library-closed {
  grid-template-columns: 0 minmax(0, 1fr);
}
.library-pane {
  /* Positioning context for the two overlays it stacks: the scrolling file list
     (.library-scroll, pinned to fill the pane) and the view-switch header
     (.library-header, pinned just under the app bar). The pane itself does NOT
     scroll or clip — the inner .library-scroll owns the scroll, and leaving the
     pane unclipped lets the view dropdown open past its edge (see de940e6). */
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
  /* An invisible grab strip straddling the pane's right edge (the column gap),
     wide enough to catch the pointer without showing UI noise. The pane is
     unclipped, so the strip can overhang into the reader a few px. */
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
  /* The pane is unclipped, so its absolutely-positioned header would otherwise
     bleed out past the 0px-wide collapsed column and show behind the open
     button. Hide it whenever the pane is snapped shut. */
  display: none;
}
.library-shell.library-closed .library-open {
  /* Pinned to the shell's left edge, below the fixed app bar. left matches the
     app bar's 22px padding so the button lines up with the leaf logo above it.
     Stays reachable once the pane column is 0px wide and clips its own contents. */
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
/* The button only shows while the pane is collapsed, and that collapsed rule
   above outranks a bare `.library-open:hover`. Scope the hover/active states to
   the same collapsed selector so the green action treatment actually wins,
   matching the settings button. */
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
/* While dragging the divider, lock the cursor and kill text selection across the
   whole window so the resize feels solid even past the thin grab strip. */
body.library-resizing {
  cursor: col-resize;
  user-select: none;
  -webkit-user-select: none;
}
.library-scroll {
  /* The scroll container, filling the pane. Top padding clears the fixed app bar
     AND the header below it, so the list starts beneath both yet can scroll up
     UNDER them — showing through the app bar's blur and the header's blur, the
     same treatment as the top app bar.
     NOTE: no `scrollbar-width`/`scrollbar-color` — in Chromium, setting either
     standard property silently disables ALL `::-webkit-scrollbar` pseudo-elements,
     which would discard both the track inset below and the thumb's min-height. */
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
  /* Pinned just below the app bar, always — absolute against the pane rather than
     sticky against the scroll, so it never drifts down with the list. The list
     slides up under it and shows through the translucent blur, the same treatment
     as the top app bar. */
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
  /* Continues the app bar's fade rather than restarting it: the app bar ramps from
     opaque down to 85% surface, so this strip picks up at that 85% and keeps fading
     to 75%. Stacked, the two headers read as one continuous translucent ramp, and
     the list shows through progressively more toward the bottom edge. */
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
.library-header button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* All-caps monospace label so the active view reads as a compact code-style
     tag. */
  font-family: var(--code-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 8px 3px 10px;
  border-radius: 6px;
  border: 0;
  /* A filled chip that lifts off the pane it sits on; the same fill in every
     view state so switching views never changes its look. A translucent neutral
     reads as "a little lighter" on the dark surface and stays visible in light
     themes too, where --app-surface-elevated would collapse to the surface. */
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
/* Shrink and dim the native disclosure triangle; the default marker reads
   oversized and bright white next to 13px folder names. Match the muted tone
   of the view caret and the project-view chevron. ::marker is modern Chromium,
   the -webkit- form is the legacy fallback. */
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
/* The row for the file that's currently open. Accent-tinted so it reads as the
   active document, and it outranks hover so the highlight holds while pointing
   elsewhere in the list. */
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
  /* Fill the row so the fade lands on empty space, not on the text, until the
     name is actually wider than the available room. Without flex:1 the label box
     hugs its text and the mask would clip every name at a fixed width. */
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
  /* Heading permalink buttons sit in the left gutter via negative positioning;
     clip keeps them from widening the horizontal scroll on narrow windows
     without turning this into a scroll container (wide content keeps its own
     inner scroll). */
  overflow-x: clip;
}
/* Reserve the minimap's footprint as right-only padding so the centered
   document sits midway between the reader's left edge (or the library pane)
   and the minimap, instead of being centered across the whole reader width
   with the minimap eating into only the right margin. */
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
/* Glossary term links read as a dotted underline in every theme and mode
   (including speed reader) so an expandable term is always visually distinct
   from a plain link. Matches both the `glossary:slug` shorthand and a real
   `…/GLOSSARY.md#slug` relative link. Placed last so it wins ties against the
   generic link and hover rules above. */
.document-body a[href^="glossary:" i],
.document-body a[href*="GLOSSARY.md#" i],
:root[data-speed-reader="true"] .document-body a[href^="glossary:" i],
:root[data-speed-reader="true"] .document-body a[href*="GLOSSARY.md#" i] {
  text-decoration: underline dotted;
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
/* Ordered lists follow the classic outline sequence by nesting depth —
   I, II, III then A, B, C then 1, 2, 3 then a, b, c then i, ii, iii — instead
   of restarting at decimal on every level. Depth is counted by ordered-list
   ancestors, so an <ol> nested inside a <ul> still reads as its own level. */
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
/* On highlighted blocks the copy button sits in the top-right corner, so nudge
   the language label left to make room. Plain (unlanguaged) blocks have no label
   and Mermaid blocks have no button, so neither needs the shift. */
.document-body pre.highlight::before {
  right: 44px;
}
/* "Copy all" button on code blocks. Always present but muted at rest so it stays
   calm, brightening on hover/focus; swaps to a check mark for a moment on copy. */
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
/* Permalink button for any anchor-addressable block. Out of flow (so it never
   nudges the text) in the left gutter, hidden until its target is hovered or the
   button itself is keyboard-focused. Its right edge meets the content's left edge
   so the cursor can cross into it without a dead zone. positionAnchorLinks() then
   shifts each button further left by its block's measured indentation, so deeply
   nested blocks still land in the same gutter as a top-level heading's button
   instead of overlapping their own indented text. */
.document-body .has-anchor-link {
  position: relative;
}
.document-body .heading-anchor {
  position: absolute;
  right: 100%;
  top: 0.7em;
  top: 0.5lh;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: transparent;
  color: var(--preview-muted-foreground);
  opacity: 0;
  pointer-events: auto;
  user-select: none;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
/* A zero-size alias that carries a heading's #locus without disturbing its
   layout (the heading keeps its slug id for the table of contents). */
.document-body .locus-alias {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
/* Anchorable blocks nest (a list item lives inside its parent list item, a
   paragraph inside its blockquote), so hovering a deep block also hovers every
   ancestor block — without the :not(:has(...)) guard each ancestor would light up
   its own button and, since they all share one gutter column now, stack as ghost
   buttons above the one you are pointing at. Reveal only the innermost hovered (or
   focused) block's button: the one that contains no other hovered/focused block. */
.document-body .has-anchor-link:hover:not(:has(.has-anchor-link:hover)) > .heading-anchor,
.document-body .has-anchor-link:focus-within:not(:has(.has-anchor-link:focus-within)) > .heading-anchor,
.document-body .has-anchor-link > .heading-anchor:hover,
.document-body .has-anchor-link > .heading-anchor:focus-visible {
  opacity: 1;
}
.document-body .heading-anchor:hover {
  background: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
/* Brief confirmation that a click copied the #locus: hold the button lit and
   green for the timeout decorateAnchorLinks sets, even after the jump scrolls. */
.document-body .heading-anchor.is-copied {
  opacity: 1;
  background: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
.heading-anchor-icon {
  width: 22px;
  height: 22px;
  pointer-events: none;
}
/* A narrow window (and any touch device, which has no true hover) can't host the
   wide left gutter the permalink centers itself in — the mark lands off-screen, and
   on touch the reveal-on-hover model double-taps (first tap reveals, second follows
   the link). The block's left-shift already lines every mark's right edge up with
   the content's left edge, so pin the glyph to that edge with flex-end and it stays
   in the sliver of visible gutter for nested blocks too; shrink it, and show it
   faintly at all times so it never needs a reveal. A direct tap/click still lights
   it bright green (the shared :hover state above, which a touch tap satisfies). */
@media (hover: none), (max-width: 600px) {
  .document-body .heading-anchor {
    justify-content: flex-end;
    padding-right: 3px;
    opacity: 0.15;
  }
  .heading-anchor-icon {
    width: 12px;
    height: 12px;
  }
  /* Hold the rest opacity through a block's sticky hover/focus so tapping body text
     (or a link inside it) doesn't flash the permalink — that flash is what swallows
     the first tap on touch. Only a direct tap/click on the mark lights it (above). */
  .document-body .has-anchor-link:hover:not(:has(.has-anchor-link:hover)) > .heading-anchor,
  .document-body .has-anchor-link:focus-within:not(:has(.has-anchor-link:focus-within)) > .heading-anchor {
    opacity: 0.15;
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
  --minimap-preview-top: 0px;
  --minimap-track-height: 100%;
  align-self: start;
  grid-area: 1 / 1;
  justify-self: end;
  position: sticky;
  top: 0;
  width: var(--minimap-width);
  /* Bleed back across the reserved right padding so the rail stays flush to
     the reader's right edge while the document centers in the space left of it. */
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
.document-minimap-content {
  position: absolute;
  top: var(--minimap-preview-top);
  right: var(--minimap-padding-inline);
  left: var(--minimap-padding-inline);
  overflow: visible;
  pointer-events: none;
}
.document-minimap-preview {
  box-sizing: border-box;
  margin: 0 !important;
  padding-top: 0 !important;
  transform-origin: 0 0;
}
.document-minimap-preview,
.document-minimap-preview * {
  pointer-events: none !important;
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
  /* Override .document-body's reading-measure width + scroll-origin margin so the
     entry fills the sheet and its scrollbar sits at the right edge (under the
     close button), not inset by an empty right strip. */
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
  /* Reset the global button:hover green fill (it out-specifies the plain
     .glossary-sheet-fulllink rule) so this reads as a plain link, like the web. */
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Clone, Copy)]
    struct Rgb {
        red: f64,
        green: f64,
        blue: f64,
    }

    fn assert_contains(haystack: &str, needle: &str) {
        assert!(
            haystack.contains(needle),
            "expected rendered HTML to contain:\n{needle}\n\nrendered HTML:\n{haystack}"
        );
    }

    fn local_img(path: &str) -> String {
        local_image_webview_url(path)
    }

    fn expected_img(src: &str, attributes: &str) -> String {
        format!(r#"<img src="{}" {}>"#, local_img(src), attributes)
    }

    fn fixture_source_path(relative_path: &str) -> PathBuf {
        std::env::temp_dir()
            .join("leaf-render-fixtures")
            .join(relative_path)
    }

    fn expected_base_href(source_path: &Path) -> String {
        source_path
            .parent()
            .and_then(|parent| Url::from_directory_path(parent).ok())
            .map(|url| format!(r#"<base href="{}">"#, encode_text(url.as_str())))
            .expect("fixture source path has a file URL")
    }

    fn file_url_for_fixture(relative_path: &str) -> String {
        Url::from_file_path(fixture_source_path(relative_path))
            .expect("fixture path has a file URL")
            .to_string()
    }

    fn absolute_path_destination_for_fixture(relative_path: &str) -> String {
        fixture_source_path(relative_path)
            .to_string_lossy()
            .replace('\\', "/")
    }

    fn tiny_png_bytes() -> &'static [u8] {
        &[
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]
    }

    fn minimap_spans(
        markdown: &str,
    ) -> Vec<(usize, usize, MinimapLineCategory, MinimapLineStructure)> {
        build_minimap_model(markdown)
            .spans
            .into_iter()
            .map(|span| {
                (
                    span.start_line,
                    span.line_count,
                    span.category,
                    span.structure,
                )
            })
            .collect()
    }

    #[test]
    fn markdown_parser_config_enables_expected_github_flavored_extensions() {
        let config = MarkdownParserConfig::github_flavored();

        for option in [
            Options::ENABLE_TABLES,
            Options::ENABLE_STRIKETHROUGH,
            Options::ENABLE_TASKLISTS,
            Options::ENABLE_GFM,
            Options::ENABLE_FOOTNOTES,
            Options::ENABLE_MATH,
        ] {
            assert!(
                config.options.contains(option),
                "expected parser config to include {option:?}"
            );
        }
    }

    #[test]
    fn markdown_pipeline_stages_keep_raw_rendering_before_sanitization() {
        let source_path = Path::new("README.md");
        let events = parse_markdown_source(
            "<script>alert(1)</script>\n\nVisit www.example.com.",
            MarkdownParserConfig::github_flavored(),
        );
        let events = register_markdown_extensions(events, source_path);
        let raw_html = render_markdown_events_to_html(events);

        assert_contains(&raw_html, "<script>alert(1)</script>");
        assert_contains(
            &raw_html,
            r#"<a href="http://www.example.com">www.example.com</a>"#,
        );

        let sanitized = sanitize_rendered_html(&raw_html);

        assert!(!sanitized.contains("<script"));
        assert_contains(
            &sanitized,
            r#"<a href="http://www.example.com" rel="noopener noreferrer">www.example.com</a>"#,
        );
    }

    #[test]
    fn minimap_model_compresses_headings_paragraphs_and_blank_lines() {
        let long_line = "A paragraph line that is deliberately long enough to cross the minimap long-line threshold for structure.";
        let markdown = format!("# Title\n\nShort paragraph.\n{long_line}\nSetext title\n---");

        let model = build_minimap_model(&markdown);

        assert_eq!(model.line_count, 6);
        assert_eq!(
            minimap_spans(&markdown),
            vec![
                (
                    0,
                    1,
                    MinimapLineCategory::Heading,
                    MinimapLineStructure::Short,
                ),
                (
                    1,
                    1,
                    MinimapLineCategory::Blank,
                    MinimapLineStructure::Short,
                ),
                (
                    2,
                    1,
                    MinimapLineCategory::Paragraph,
                    MinimapLineStructure::Short,
                ),
                (
                    3,
                    1,
                    MinimapLineCategory::Paragraph,
                    MinimapLineStructure::Long,
                ),
                (
                    4,
                    2,
                    MinimapLineCategory::Heading,
                    MinimapLineStructure::Short,
                ),
            ]
        );
    }

    #[test]
    fn minimap_model_classifies_lists_and_blockquotes() {
        let markdown = "- first\n- second\n\n1. ordered\n> quote\n> - quoted list\nplain";

        assert_eq!(
            minimap_spans(markdown),
            vec![
                (0, 2, MinimapLineCategory::List, MinimapLineStructure::Short,),
                (
                    2,
                    1,
                    MinimapLineCategory::Blank,
                    MinimapLineStructure::Short,
                ),
                (3, 1, MinimapLineCategory::List, MinimapLineStructure::Short,),
                (
                    4,
                    2,
                    MinimapLineCategory::Blockquote,
                    MinimapLineStructure::Short,
                ),
                (
                    6,
                    1,
                    MinimapLineCategory::Paragraph,
                    MinimapLineStructure::Short,
                ),
            ]
        );
    }

    #[test]
    fn minimap_model_keeps_fenced_code_lines_together() {
        let markdown =
            "```rs\n# not a heading\n- not a list\n```\n\n~~~\n> not a quote\n~~~\n# Heading";

        assert_eq!(
            minimap_spans(markdown),
            vec![
                (
                    0,
                    4,
                    MinimapLineCategory::CodeFence,
                    MinimapLineStructure::Short,
                ),
                (
                    4,
                    1,
                    MinimapLineCategory::Blank,
                    MinimapLineStructure::Short,
                ),
                (
                    5,
                    3,
                    MinimapLineCategory::CodeFence,
                    MinimapLineStructure::Short,
                ),
                (
                    8,
                    1,
                    MinimapLineCategory::Heading,
                    MinimapLineStructure::Short,
                ),
            ]
        );
    }

    #[test]
    fn minimap_model_compresses_large_documents() {
        let markdown = (0..1_000)
            .map(|index| format!("Paragraph line {index}"))
            .collect::<Vec<_>>()
            .join("\n");

        let model = build_minimap_model(&markdown);

        assert_eq!(model.line_count, 1_000);
        assert_eq!(model.spans.len(), 1);
        assert_eq!(model.spans[0].category, MinimapLineCategory::Paragraph);
        assert_eq!(model.spans[0].line_count, 1_000);
    }

    #[test]
    fn minimap_model_does_not_render_or_store_malicious_content() {
        let markdown = r#"# Safe

<script>alert("x")</script>
<img src=x onerror=alert(1)>

```html
<script>inside code</script>
```
"#;

        let model = build_minimap_model(markdown);
        let serialized =
            serde_json::to_string(&model).expect("minimap model serializes for UI handoff");

        assert_eq!(model.line_count, 8);
        assert_eq!(
            minimap_spans(markdown),
            vec![
                (
                    0,
                    1,
                    MinimapLineCategory::Heading,
                    MinimapLineStructure::Short,
                ),
                (
                    1,
                    1,
                    MinimapLineCategory::Blank,
                    MinimapLineStructure::Short,
                ),
                (
                    2,
                    2,
                    MinimapLineCategory::Paragraph,
                    MinimapLineStructure::Short,
                ),
                (
                    4,
                    1,
                    MinimapLineCategory::Blank,
                    MinimapLineStructure::Short,
                ),
                (
                    5,
                    3,
                    MinimapLineCategory::CodeFence,
                    MinimapLineStructure::Short,
                ),
            ]
        );
        assert!(!serialized.contains("<script"));
        assert!(!serialized.contains("onerror"));
        assert_eq!(
            markdown,
            r#"# Safe

<script>alert("x")</script>
<img src=x onerror=alert(1)>

```html
<script>inside code</script>
```
"#
        );
    }

    #[test]
    fn minimap_model_covers_released_categories_without_source_payloads() {
        let markdown = "# Heading\n\nParagraph line that is deliberately long enough to become a long minimap structure entry.\n- list item\n> quote\n```rs\nfn main() {}\n```\n";

        let model = build_minimap_model(markdown);
        let serialized =
            serde_json::to_string(&model).expect("minimap model serializes for UI handoff");

        assert_eq!(model.line_count, 8);
        for expected in [
            r#""category":"heading""#,
            r#""category":"blank""#,
            r#""category":"paragraph""#,
            r#""category":"list""#,
            r#""category":"blockquote""#,
            r#""category":"code-fence""#,
            r#""structure":"long""#,
            r#""structure":"short""#,
            r#""start_line":"#,
            r#""line_count":"#,
        ] {
            assert_contains(&serialized, expected);
        }
        for forbidden in [
            "Heading",
            "Paragraph line",
            "list item",
            "> quote",
            "fn main",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "minimap handoff should not store source text: {forbidden}"
            );
        }
        assert_eq!(
            markdown,
            "# Heading\n\nParagraph line that is deliberately long enough to become a long minimap structure entry.\n- list item\n> quote\n```rs\nfn main() {}\n```\n"
        );
    }

    #[test]
    fn minimap_model_keeps_large_documents_compressed_by_runs() {
        let markdown = (0..20_000)
            .map(|index| match index % 5 {
                0 => "# Section".to_string(),
                1 => String::new(),
                2 | 3 => "Paragraph line".to_string(),
                _ => "- list item".to_string(),
            })
            .collect::<Vec<_>>()
            .join("\n");

        let model = build_minimap_model(&markdown);

        assert_eq!(model.line_count, 20_000);
        assert_eq!(model.spans.len(), 16_000);
        assert!(
            model.spans.len() < model.line_count,
            "large documents should render from compressed structural runs"
        );
        assert!(model
            .spans
            .iter()
            .any(|span| span.line_count > 1 && span.category == MinimapLineCategory::Paragraph));
    }

    #[test]
    fn opened_document_carries_minimap_model_for_webview_state() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("leaf-minimap-state-{unique}.md"));
        fs::write(&path, "# Map\n\nParagraph.\n\n```rs\nfn main() {}\n```")
            .expect("test markdown is written");

        let document = load_document(&path).expect("test markdown loads");
        let script = document_state_script(&document, &[]);

        fs::remove_file(&path).expect("test markdown is removed");

        assert_eq!(document.minimap.line_count, 7);
        assert!(document
            .minimap
            .spans
            .iter()
            .any(|span| span.category == MinimapLineCategory::Heading));
        assert!(document
            .minimap
            .spans
            .iter()
            .any(|span| span.category == MinimapLineCategory::CodeFence));
        assert_contains(&script, r#""minimap":{"line_count":7,"spans":["#);
        assert_contains(&script, r#""category":"heading""#);
        assert_contains(&script, r#""category":"code-fence""#);
    }

    #[test]
    fn navigation_state_script_updates_webview_navigation_controls() {
        assert_eq!(
            navigation_state_script(true, false),
            r#"window.leafSetNavigation({"canGoBack":true,"canGoForward":false});"#
        );
    }

    #[test]
    fn initial_state_script_returns_reader_to_no_file_state_with_recent_files() {
        let script = initial_state_script(&[PathBuf::from("README.md")]);

        assert_eq!(
            script,
            r#"window.__leafInitialState = {"document":null,"recent":["README.md"]};"#
        );
    }

    #[test]
    fn scroll_anchor_script_restores_webview_reader_anchor() {
        assert_eq!(
            scroll_anchor_script(&ScrollAnchor {
                section: Some("the-asuras".to_string()),
                block: 3,
                offset_y: -88.0,
            }),
            r#"window.leafRestoreScrollAnchor({"section":"the-asuras","block":3,"offsetY":-88.0});"#
        );
        // A position above the first heading carries a null section.
        assert_eq!(
            scroll_anchor_script(&ScrollAnchor::default()),
            r#"window.leafRestoreScrollAnchor({"section":null,"block":0,"offsetY":0.0});"#
        );
    }

    #[test]
    fn workspace_reload_script_preserves_scroll_via_reload_entry_point() {
        let tabs = [("Guide".to_string(), "guide.md".to_string())];
        let script = workspace_reload_script(&[PathBuf::from("guide.md")], &tabs, Some(0), None);

        // The reload path must call leafReloadDocument (which keeps the reader's
        // scroll position), never leafSetState (which jumps back to the top).
        assert!(script.starts_with("window.leafReloadDocument({"));
        assert!(!script.contains("leafSetState"));
        assert_contains(&script, r#""active":0"#);
        assert_contains(&script, r#""title":"Guide""#);
    }

    #[test]
    fn workspace_switch_script_restores_target_tab_anchor_without_reset() {
        let tabs = [("Guide".to_string(), "guide.md".to_string())];
        let anchor = ScrollAnchor {
            section: Some("intro".to_string()),
            block: 2,
            offset_y: 12.5,
        };
        let script = workspace_switch_script(
            &[PathBuf::from("guide.md")],
            &tabs,
            Some(0),
            None,
            Some(&anchor),
        );

        // Switching must render through leafSwitchTab (renders, then restores the
        // saved anchor) rather than leafSetState (which snaps back to the top).
        assert!(script.starts_with("window.leafSwitchTab({"));
        assert!(!script.contains("leafSetState"));
        assert_contains(&script, r#""active":0"#);
        assert!(script.ends_with(r#", {"section":"intro","block":2,"offsetY":12.5});"#));

        // No saved anchor (first visit to a tab) passes null, which starts the
        // reader at the top of the content.
        assert!(workspace_switch_script(&[], &[], None, None, None).ends_with(", null);"));
    }

    #[test]
    fn opened_document_from_markdown_matches_loading_from_disk() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        // Use a dedicated subdirectory so the on-disk load and already-read
        // render both see the same source path.
        let dir = std::env::temp_dir().join(format!("leaf-reload-parity-{unique}"));
        fs::create_dir_all(&dir).expect("test directory is created");
        let path = dir.join("doc.md");
        let markdown = "# Reloaded\n\nBody text.\n";
        fs::write(&path, markdown).expect("test markdown is written");

        let from_disk = load_document(&path).expect("test markdown loads");
        let from_memory = opened_document_from_markdown(markdown, &path);

        fs::remove_dir_all(&dir).expect("test directory is removed");

        // Rendering the already-read string must produce the same document the
        // on-disk loader would, so the live-reload path can read the file once.
        assert_eq!(from_memory.title, from_disk.title);
        assert_eq!(from_memory.html, from_disk.html);
        assert_eq!(from_memory.path, from_disk.path);
        assert_eq!(from_memory.minimap, from_disk.minimap);
    }

    #[test]
    fn opened_document_starts_with_async_pager_placeholder() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("leaf-async-pager-{unique}"));
        fs::create_dir_all(&root).expect("tree is created");
        fs::write(root.join("README.md"), "# Root\n").expect("README written");
        let current = root.join("current.md");
        let next = root.join("next-page.md");
        fs::write(&current, "# Current\n").expect("current document written");
        fs::write(&next, "# Next\n").expect("next document written");

        let document = opened_document_from_markdown("# Current\n", &current);
        let pager = document_pager_html(&current);
        fs::remove_dir_all(&root).expect("tree removed");

        assert_contains(&document.html, "docs-pager-loading");
        assert_contains(&document.html, "docs-pager-skeleton");
        assert!(
            !document.html.contains("Next Page"),
            "document render should not synchronously scan pager neighbours"
        );
        assert_contains(&pager, "Next Page");
    }

    #[test]
    fn pager_loaded_script_routes_through_webview_hook() {
        let path = PathBuf::from("docs").join("guide.md");
        let script = pager_loaded_script(&path, r#"<nav class="docs-pager"></nav>"#);

        assert!(script.starts_with("window.leafSetPager({"));
        assert_contains(&script, "guide.md");
        assert_contains(&script, r#""html":"<nav class=\"docs-pager\"></nav>""#);
    }

    #[test]
    fn pager_label_matches_web_label_rule() {
        assert_eq!(
            pager_label("book-1-words-of-the-buddha--kangyur"),
            "Book 1 Words Of The Buddha Kangyur"
        );
        assert_eq!(pager_label("going-forth.md"), "Going Forth");
        assert_eq!(pager_label("get_started"), "Get Started");
    }

    #[test]
    fn pager_orders_by_folder_tree_like_the_web_viewer() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("leaf-pager-{unique}"));
        let book = root.join("book-1-words-of-the-buddha--kangyur");
        let section = book.join("discipline--vinayavastu");
        let chapter = section.join("chapter-1-going-forth--pravrajyavastu");
        fs::create_dir_all(&chapter).expect("tree is created");
        for dir in [&root, &book, &section, &chapter] {
            fs::write(dir.join("README.md"), "# x\n").expect("README written");
        }
        fs::write(root.join("GLOSSARY.md"), "# Glossary\n").expect("glossary written");

        // Standing on the section README, prev is its parent book and next is its
        // child chapter — the same neighbours the web pager shows.
        let html = pager_html(&section.join("README.md"));
        fs::remove_dir_all(&root).expect("tree removed");

        assert!(
            html.contains(r#"class="docs-pager-prev""#)
                && html.contains("Book 1 Words Of The Buddha Kangyur"),
            "prev should link the parent book: {html}"
        );
        assert!(
            html.contains(r#"class="docs-pager-next""#)
                && html.contains("Chapter 1 Going Forth Pravrajyavastu"),
            "next should link the child chapter: {html}"
        );
        // GLOSSARY.md is opened in the sheet, never a sequential page.
        assert!(
            !html.contains("Glossary"),
            "glossary must not be a pager page: {html}"
        );
    }

    #[test]
    fn document_title_strips_raw_html_from_markdown_heading() {
        let rendered = render_markdown_document(
            r#"# <div align="center">Words of My Perfect Teacher</div>

Body stays readable.
"#,
            "README.md",
        );

        assert_eq!(rendered.title, "Words of My Perfect Teacher");
        assert!(!rendered.title.contains("<div"));
        assert!(!rendered.title.contains("</div>"));
        assert_contains(&rendered.html, "Words of My Perfect Teacher");
    }

    #[test]
    fn document_title_uses_plain_text_for_heading_inline_markup() {
        let rendered = render_markdown_document(
            r#"# *Perfect* [Teacher &amp; Guide](guide.md) ![Alt &amp; Image](cover.png) `code` <span>plain&nbsp;text</span>"#,
            "README.md",
        );

        assert_eq!(
            rendered.title,
            "Perfect Teacher & Guide Alt & Image code plain text"
        );
        for raw_markup in ["*", "[", "](", "![", "`", "<span", "&amp;", "&nbsp;"] {
            assert!(
                !rendered.title.contains(raw_markup),
                "title should not contain raw markup {raw_markup:?}: {}",
                rendered.title
            );
        }
    }

    #[test]
    fn document_title_preserves_literal_comparison_text() {
        let rendered = render_markdown_document("# 1 < 2 &amp; 3 > 2", "README.md");

        assert_eq!(rendered.title, "1 < 2 & 3 > 2");
    }

    #[test]
    fn document_title_can_come_from_raw_html_heading_or_block() {
        let raw_heading = render_markdown_document(
            r#"<h1><em>Raw</em> HTML &amp; Heading</h1>

Body.
"#,
            "README.md",
        );
        let raw_block = render_markdown_document(
            r#"<div align="center">Words of My Perfect Teacher</div>

Body.
"#,
            "README.md",
        );

        assert_eq!(raw_heading.title, "Raw HTML & Heading");
        assert_eq!(raw_block.title, "Words of My Perfect Teacher");
        assert!(!raw_heading.title.contains("<em>"));
        assert!(!raw_block.title.contains("align="));
    }

    #[test]
    fn raw_html_anchor_ids_survive_so_in_page_links_resolve() {
        // GitHub authors anchor targets with explicit `id=` on raw-HTML elements
        // (e.g. `<h1 id="forewordhhdl">`). Links like `[Foreword](#forewordhhdl)`
        // only scroll if that id reaches the rendered DOM, so the sanitizers must
        // keep `id` on the tags that carry these anchors.
        let rendered = render_markdown_document(
            r#"[Foreword](#forewordhhdl) [Plate](#guru-rinpoche-il) [Notice](#copyright) [Spearman](#black-spearman)

<h1 id="forewordhhdl" align="center" onclick="bad()">Foreword</h1>
<p id="guru-rinpoche-il">Plate caption.</p>
<div id="copyright">Notice.</div>
<a id="black-spearman">Spearman.</a>
"#,
            "README.md",
        );

        assert_contains(&rendered.html, r#"id="forewordhhdl""#);
        assert_contains(&rendered.html, r#"id="guru-rinpoche-il""#);
        assert_contains(&rendered.html, r#"id="copyright""#);
        assert_contains(&rendered.html, r#"id="black-spearman""#);
        // The id rides through, but unsafe attributes on the same tag still go.
        assert!(!rendered.html.contains("onclick"));
    }

    #[test]
    fn document_state_script_never_serializes_raw_title_markup() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("leaf-title-state-{unique}.md"));
        fs::write(
            &path,
            r#"# <div align="center">Words &amp; My Perfect Teacher</div>

![Image alt](cover.png)
"#,
        )
        .expect("test markdown is written");

        let document = load_document(&path).expect("test markdown loads");
        let script = document_state_script(&document, &[]);

        fs::remove_file(&path).expect("test markdown is removed");

        assert_eq!(document.title, "Words & My Perfect Teacher");
        assert_contains(&script, r#""title":"Words & My Perfect Teacher""#);
        assert!(!script.contains(r#""title":"<div"#));
        assert!(!script.contains(r#""title":"Words &amp;"#));
    }

    #[test]
    fn fragment_scroll_script_escapes_fragment_for_webview_handoff() {
        assert_eq!(
            fragment_scroll_script(r#"Section "One""#),
            r#"window.leafScrollToFragment("Section \"One\"");"#
        );
    }

    #[test]
    fn sanitizer_boundary_allows_preview_markup_and_removes_unsafe_markup() {
        let html = r##"<pre class="highlight" data-language="Rust" onclick="bad()"><code class="language-rust"><span class="syn-keyword" title="kw" aria-label="keyword">fn</span></code></pre>
<table><tr><td style="text-align:center;color:red">cell</td></tr></table>
<div align="center" onclick="bad()">centered</div>
<a href="javascript:alert(1)" class="issue-link" aria-label="issue">bad</a>
<a class="footnote-backref" href="#fnref-one" aria-label="Back to content"><svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M9.3,15.1l-6-6M3.3,9.1l6-6M3.3,9.1h12c3.3,0,6,2.7,6,6s-2.7,6-6,6h-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" onclick="bad()"/></svg></a>
<script>alert(1)</script>"##;

        let sanitized = sanitize_rendered_html(html);

        assert_contains(
            &sanitized,
            r#"<pre class="highlight" data-language="Rust"><code class="language-rust"><span class="syn-keyword" title="kw" aria-label="keyword">fn</span></code></pre>"#,
        );
        assert_contains(&sanitized, r#"<td>cell</td>"#);
        assert_contains(&sanitized, r#"<div align="center">centered</div>"#);
        assert_contains(
            &sanitized,
            r#"<a class="issue-link" aria-label="issue" rel="noopener noreferrer">bad</a>"#,
        );
        assert_contains(
            &sanitized,
            r##"<a class="footnote-backref" href="#fnref-one" aria-label="Back to content" rel="noopener noreferrer"><svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"##,
        );
        assert_contains(
            &sanitized,
            r#"<path d="M9.3,15.1l-6-6M3.3,9.1l6-6M3.3,9.1h12c3.3,0,6,2.7,6,6s-2.7,6-6,6h-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>"#,
        );
        assert!(!sanitized.contains("onclick"));
        assert!(!sanitized.contains("style="));
        assert!(!sanitized.contains("color:red"));
        assert!(!sanitized.contains("<script"));
        assert!(!sanitized.contains("javascript:"));
    }

    #[test]
    fn sanitizer_allows_local_image_protocol_urls() {
        let sanitized = sanitize_rendered_html(
            r#"<img src="leaf-image://local/nested/space%20image.png" alt="x">"#,
        );

        assert_contains(
            &sanitized,
            r#"<img src="leaf-image://local/nested/space%20image.png" alt="x">"#,
        );
    }

    #[test]
    fn sanitizer_allows_webview_local_image_workaround_urls() {
        let sanitized = sanitize_rendered_html(&format!(
            r#"<img src="{}" alt="x" onerror="alert(1)">"#,
            local_img("nested/space%20image.png")
        ));

        assert_contains(
            &sanitized,
            &expected_img("nested/space%20image.png", r#"alt="x""#),
        );
        assert!(!sanitized.contains("onerror"));
    }

    #[test]
    fn highlighter_boundary_escapes_when_requested_language_has_no_syntax() {
        let language = LanguageDefinition {
            display_name: "Imaginary",
            syntax_names: &["Imaginary Leaf Syntax"],
            syntax_tokens: &["imaginary-leaf-syntax"],
        };

        assert_eq!(
            highlight_code("<b>raw</b>", &language),
            None,
            "missing syntaxes should not produce highlighter HTML"
        );

        let rendered = render_code_block(&CodeBlockCapture {
            language: Some("imaginary-leaf-syntax".to_string()),
            code: "<b>raw</b>".to_string(),
        });

        assert_contains(&rendered, r#"data-language="imaginary-leaf-syntax""#);
        assert_contains(&rendered, "&lt;b&gt;raw&lt;/b&gt;");
        assert!(!rendered.contains("<b>raw</b>"));
    }

    fn css_token(css: &str, theme: ResolvedTheme, name: &str) -> Rgb {
        let leaf_alias_block = css_block(css, ":root {");
        let mut blocks = vec![leaf_alias_block];
        match theme {
            ResolvedTheme::Light => {
                blocks.extend(css_blocks(css, &format!("{PRIMER_LIGHT_SELECTOR} {{")));
            }
            ResolvedTheme::Dark => {
                blocks.extend(css_blocks(css, &format!("{PRIMER_DARK_SELECTOR} {{")));
            }
        };
        let value = css_token_value(&blocks, name);

        parse_hex_color(&value)
            .or_else(|| {
                let background = css_token_value(&blocks, "--bgColor-default");
                parse_hex_color(&background)
                    .and_then(|background| parse_hex_color_with_alpha(&value, background))
            })
            .unwrap_or_else(|| panic!("expected {name} to resolve to a hex color"))
    }

    fn css_token_for_source(css: &str, source: &ThemeSource, name: &str) -> Rgb {
        let mut blocks = css_blocks(css, &format!("{} {{", source.selector));
        if source.kind == ThemeSourceKind::Primer {
            let selector = match source.id {
                "primer-light" => PRIMER_LIGHT_SELECTOR,
                "primer-dark" => PRIMER_DARK_SELECTOR,
                _ => source.selector,
            };
            blocks.extend(css_blocks(css, &format!("{selector} {{")));
        }
        let value = css_token_value(&blocks, name);

        parse_hex_color(&value)
            .or_else(|| {
                let background = css_token_value(&blocks, "--leaf-app-background");
                parse_hex_color(&background)
                    .and_then(|background| parse_hex_color_with_alpha(&value, background))
            })
            .unwrap_or_else(|| panic!("expected {} {name} to resolve to a hex color", source.id))
    }

    fn css_block<'a>(css: &'a str, selector: &str) -> &'a str {
        css_blocks(css, selector)
            .into_iter()
            .next()
            .unwrap_or_else(|| panic!("expected CSS block {selector}"))
    }

    fn css_blocks<'a>(css: &'a str, selector: &str) -> Vec<&'a str> {
        css.split(selector)
            .skip(1)
            .filter_map(|rest| rest.split_once("\n}").map(|(block, _)| block))
            .collect()
    }

    fn css_token_value(blocks: &[&str], name: &str) -> String {
        let declaration = blocks
            .iter()
            .flat_map(|block| block.lines())
            .map(str::trim)
            .find(|line| line.starts_with(name))
            .unwrap_or_else(|| panic!("expected CSS token {name} in theme block"));
        let value = declaration
            .split_once(':')
            .and_then(|(_, value)| value.trim().split_once(';').map(|(value, _)| value.trim()))
            .unwrap_or_else(|| panic!("expected CSS declaration value for {name}"));

        if let Some(alias) = value
            .strip_prefix("var(")
            .and_then(|value| value.strip_suffix(')'))
        {
            return css_token_value(blocks, alias).to_string();
        }

        value.to_string()
    }

    fn parse_hex_color(value: &str) -> Option<Rgb> {
        let hex = value.strip_prefix('#')?;
        if hex.len() != 6 {
            return None;
        }
        Some(Rgb {
            red: u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0,
            green: u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0,
            blue: u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0,
        })
    }

    fn parse_hex_color_with_alpha(value: &str, background: Rgb) -> Option<Rgb> {
        let hex = value.strip_prefix('#')?;
        if hex.len() != 8 {
            return None;
        }
        let foreground = Rgb {
            red: u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0,
            green: u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0,
            blue: u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0,
        };
        let alpha = u8::from_str_radix(&hex[6..8], 16).ok()? as f64 / 255.0;

        Some(Rgb {
            red: foreground.red * alpha + background.red * (1.0 - alpha),
            green: foreground.green * alpha + background.green * (1.0 - alpha),
            blue: foreground.blue * alpha + background.blue * (1.0 - alpha),
        })
    }

    fn contrast_ratio(foreground: Rgb, background: Rgb) -> f64 {
        let foreground = relative_luminance(foreground);
        let background = relative_luminance(background);
        let (lighter, darker) = if foreground >= background {
            (foreground, background)
        } else {
            (background, foreground)
        };

        (lighter + 0.05) / (darker + 0.05)
    }

    fn relative_luminance(color: Rgb) -> f64 {
        fn linearize(channel: f64) -> f64 {
            if channel <= 0.03928 {
                channel / 12.92
            } else {
                ((channel + 0.055) / 1.055).powf(2.4)
            }
        }

        0.2126 * linearize(color.red)
            + 0.7152 * linearize(color.green)
            + 0.0722 * linearize(color.blue)
    }

    fn assert_contrast_at_least(
        css: &str,
        theme: ResolvedTheme,
        foreground: &str,
        background: &str,
        minimum: f64,
    ) {
        let ratio = contrast_ratio(
            css_token(css, theme, foreground),
            css_token(css, theme, background),
        );
        assert!(
            ratio >= minimum,
            "expected {theme:?} {foreground} on {background} contrast {ratio:.2} to be at least {minimum:.1}"
        );
    }

    #[test]
    fn renders_commonmark_headings_and_paragraphs() {
        let markdown = r#"# H1

Paragraph after H1.

## H2

Paragraph after H2.

### H3

Paragraph after H3.

#### H4

Paragraph after H4.

##### H5

Paragraph after H5.

###### H6

Paragraph after H6.
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_eq!(rendered.title, "H1");
        for level in 1..=6 {
            assert_contains(
                &rendered.html,
                &format!(r#"<h{level} id="h{level}">H{level}</h{level}>"#),
            );
            assert_contains(&rendered.html, &format!("<p>Paragraph after H{level}.</p>"));
        }
    }

    #[test]
    fn renders_commonmark_emphasis_variants_and_escapes() {
        let markdown = r#"**asterisk bold** and __underscore bold__.

*asterisk italic* and _underscore italic_.

***asterisk bold italic*** and ___underscore bold italic___.

\*escaped asterisk\* and \[escaped bracket\].
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(&rendered.html, "<strong>asterisk bold</strong>");
        assert_contains(&rendered.html, "<strong>underscore bold</strong>");
        assert_contains(&rendered.html, "<em>asterisk italic</em>");
        assert_contains(&rendered.html, "<em>underscore italic</em>");
        assert_contains(
            &rendered.html,
            "<em><strong>asterisk bold italic</strong></em>",
        );
        assert_contains(
            &rendered.html,
            "<em><strong>underscore bold italic</strong></em>",
        );
        assert_contains(
            &rendered.html,
            "<p>*escaped asterisk* and [escaped bracket].</p>",
        );
    }

    #[test]
    fn renders_commonmark_blockquotes_and_nested_lists() {
        let markdown = r#"> outer
> > nested

1. first
   1. nested first
   2. nested second
2. second

- dash
  * star
    + plus
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(&rendered.html, "<blockquote>");
        assert_contains(&rendered.html, "<p>outer</p>");
        assert_contains(&rendered.html, "<p>nested</p>");
        assert_contains(&rendered.html, "<ol>");
        assert_contains(&rendered.html, "<li>nested first</li>");
        assert_contains(&rendered.html, "<ul>");
        assert_contains(&rendered.html, "<li>plus</li>");
    }

    #[test]
    fn renders_commonmark_code_blocks_links_images_and_rules() {
        let markdown = r#"Paragraph with `inline code`.

Paragraph with [a link](https://example.com).

[a titled link](https://example.com "Example title").

![Alt text](images/example.svg "Example image")

```rust
fn main() {}
```

~~~text
tilde fence
~~~

    indented code

---

***

___
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(&rendered.html, "<code>inline code</code>");
        assert_contains(
            &rendered.html,
            r#"<a href="https://example.com" rel="noopener noreferrer">a link</a>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<a href="https://example.com" title="Example title" rel="noopener noreferrer">a titled link</a>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<img src="images/example.svg" alt="Alt text" title="Example image">"#,
        );
        assert_contains(
            &rendered.html,
            "<pre class=\"highlight\" data-language=\"Rust\"><code class=\"language-rust\">",
        );
        assert_contains(
            &rendered.html,
            "<pre class=\"highlight\" data-language=\"Text\"><code class=\"language-text\">",
        );
        assert_contains(&rendered.html, "tilde fence");
        assert_contains(&rendered.html, "<pre><code>indented code");
        assert_eq!(rendered.html.matches("<hr>").count(), 3);
    }

    #[test]
    fn uses_image_alt_text_as_title_tooltip_when_no_title_is_given() {
        let markdown = "![im the alt text in the box](images/example.svg)";

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<img src="images/example.svg" alt="im the alt text in the box" title="im the alt text in the box">"#,
        );
    }

    #[test]
    fn keeps_explicit_image_title_over_alt_text() {
        let markdown = r#"![Alt text](images/example.svg "Real title")"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<img src="images/example.svg" alt="Alt text" title="Real title">"#,
        );
    }

    #[test]
    fn renders_simplified_chinese_markdown_without_translating_source_content() {
        let markdown = r#"# Leaf 🍁 使用指南

这是一个包含中文标点、emoji 和链接的段落：[项目链接](https://example.com/leaf)。

## 功能列表

- 阅读 `README.md`
- 保留 Leaf 🍁 名称

| 项目 | 状态 |
| --- | --- |
| 预览 | 可用 |

```ts
const message = "你好，Leaf";
console.log(message);
```
"#;

        let rendered = render_markdown_document(markdown, "中文指南.md");

        assert_eq!(rendered.title, "Leaf 🍁 使用指南");
        assert_contains(&rendered.html, r#"<h1 id="leaf--使用指南">"#);
        assert_contains(&rendered.html, "中文标点、emoji");
        assert_contains(
            &rendered.html,
            r#"<a href="https://example.com/leaf" rel="noopener noreferrer">项目链接</a>"#,
        );
        assert_contains(&rendered.html, "<li>阅读 <code>README.md</code></li>");
        assert_contains(&rendered.html, "<td>预览</td>");
        assert_contains(
            &rendered.html,
            r#"<pre class="highlight" data-language="TypeScript"><code class="language-typescript">"#,
        );
        assert_contains(&rendered.html, "你好，Leaf");
        assert!(!rendered.html.contains("Hello"));
    }

    #[test]
    fn renders_syntax_highlighted_fenced_code_blocks() {
        let markdown = r#"```rs title="main.rs" {1,3-5}
pub fn main() {
    let value = 1;
}
```"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<pre class="highlight" data-language="Rust"><code class="language-rust">"#,
        );
        assert_contains(&rendered.html, "syn-storage");
        assert_contains(&rendered.html, "pub");
        assert_contains(&rendered.html, "fn");
        assert_contains(&rendered.html, "let");
        assert!(!rendered.html.contains("title=&quot;main.rs&quot;"));
    }

    #[test]
    fn renders_diff_additions_and_removals_with_theme_token_classes() {
        let markdown = r#"```diff
+added line
-removed line
@@ -1 +1 @@
 unchanged
```"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<pre class="highlight" data-language="Diff"><code class="language-diff">"#,
        );
        assert_contains(&rendered.html, "syn-inserted");
        assert_contains(&rendered.html, "syn-deleted");
        assert_contains(&rendered.html, "added line");
        assert_contains(&rendered.html, "removed line");
    }

    #[test]
    fn supports_foundation_fenced_code_language_aliases() {
        let cases = [
            (
                "ts",
                "TypeScript",
                "language-typescript",
                "export const value: number = 1;",
            ),
            (
                "typescript",
                "TypeScript",
                "language-typescript",
                "interface User { name: string }",
            ),
            (
                "tsx",
                "TSX",
                "language-tsx",
                "export const App = () => <main>Hello</main>;",
            ),
            (
                "js",
                "JavaScript",
                "language-javascript",
                "const value = 1;",
            ),
            (
                "javascript",
                "JavaScript",
                "language-javascript",
                "function run() { return true; }",
            ),
            (
                "jsx",
                "JSX",
                "language-jsx",
                "export const App = () => <main>Hello</main>;",
            ),
            (
                "json",
                "JSON",
                "language-json",
                r#"{ "enabled": true, "count": 1 }"#,
            ),
            (
                "jsonc",
                "JSONC",
                "language-jsonc",
                r#"{ "enabled": true, "count": 1 }"#,
            ),
            (
                "html",
                "HTML",
                "language-html",
                "<div class=\"card\">Text</div>",
            ),
            ("css", "CSS", "language-css", ".card { color: red; }"),
            (
                "scss",
                "SCSS",
                "language-scss",
                "$color: red; .card { color: $color; }",
            ),
            ("md", "Markdown", "language-markdown", "# Title"),
            ("markdown", "Markdown", "language-markdown", "## Heading"),
            ("bash", "Bash", "language-bash", "echo \"$HOME\""),
            ("sh", "Bash", "language-bash", "printf '%s\\n' \"$SHELL\""),
            ("shell", "Bash", "language-bash", "set -euo pipefail"),
            ("zsh", "Bash", "language-bash", "autoload -Uz compinit"),
            ("yaml", "YAML", "language-yaml", "enabled: true"),
            ("yml", "YAML", "language-yaml", "items:\n  - one"),
            (
                "toml",
                "TOML",
                "language-toml",
                "[package]\nname = \"leaf\"",
            ),
            ("xml", "XML", "language-xml", "<root enabled=\"true\" />"),
            (
                "rust",
                "Rust",
                "language-rust",
                "pub fn main() { let value = 1; }",
            ),
            ("rs", "Rust", "language-rust", "fn main() {}"),
            (
                "python",
                "Python",
                "language-python",
                "def run():\n    return True",
            ),
            ("py", "Python", "language-python", "print('leaf')"),
            ("sql", "SQL", "language-sql", "select * from documents;"),
            ("diff", "Diff", "language-diff", "+added\n-removed"),
            ("patch", "Diff", "language-diff", "@@ -1 +1 @@\n-old\n+new"),
            ("ini", "INI", "language-ini", "[leaf]\nenabled=true"),
            ("dotenv", "Dotenv", "language-dotenv", "LEAF_MODE=preview"),
            (
                "dockerfile",
                "Dockerfile",
                "language-dockerfile",
                "FROM scratch",
            ),
            (
                "graphql",
                "GraphQL",
                "language-graphql",
                "query Leaf { title }",
            ),
            (
                "gql",
                "GraphQL",
                "language-graphql",
                "mutation Save { save }",
            ),
            ("text", "Text", "language-text", "plain text"),
            ("plain", "Text", "language-text", "plain fallback"),
        ];

        for (identifier, display, class_name, code) in cases {
            let rendered =
                render_markdown_document(&format!("```{identifier}\n{code}\n```"), "README.md");

            assert_contains(
                &rendered.html,
                &format!(
                    r#"<pre class="highlight" data-language="{display}"><code class="{class_name}">"#
                ),
            );
            assert_contains(&rendered.html, "syn-");
        }
    }

    #[test]
    fn supported_language_aliases_resolve_to_bundled_syntaxes() {
        for identifier in [
            "ts",
            "typescript",
            "tsx",
            "js",
            "javascript",
            "jsx",
            "json",
            "jsonc",
            "html",
            "css",
            "scss",
            "md",
            "markdown",
            "bash",
            "sh",
            "shell",
            "zsh",
            "yaml",
            "yml",
            "toml",
            "xml",
            "rust",
            "rs",
            "python",
            "py",
            "sql",
            "diff",
            "patch",
            "ini",
            "dotenv",
            "dockerfile",
            "graphql",
            "gql",
            "plain",
        ] {
            let language = language_definition(identifier)
                .unwrap_or_else(|| panic!("expected {identifier} to be supported"));
            assert!(
                find_syntax(syntax_set(), &language).is_some(),
                "expected {identifier} to resolve to a bundled syntax"
            );
        }
    }

    #[test]
    fn falls_back_safely_for_unknown_and_empty_code_blocks() {
        let markdown = r#"```unknownlang
const value = "<raw>";
```

```
plain without language
```

```ts" onmouseover="alert(1)
const safe = true;
```

```
```"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<pre class="highlight" data-language="unknownlang"><code class="language-unknownlang">const value = "&lt;raw&gt;";"#,
        );
        assert_contains(&rendered.html, "<pre><code>plain without language");
        assert_contains(
            &rendered.html,
            r#"<pre class="highlight" data-language="ts&quot;"><code class="language-ts">"#,
        );
        assert_contains(&rendered.html, "<pre><code></code></pre>");
        assert!(!rendered.html.contains("onmouseover"));
        assert!(!rendered.html.contains("<script"));
    }

    #[test]
    fn escapes_malicious_code_fence_language_identifiers() {
        let markdown = r#"```"><img src=x onerror=alert(1)
<script>alert("identifier")</script>
```

```bad/lang<script>
const value = "<raw>";
```"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<pre class="highlight" data-language="&quot;><img"><code class="language-img">"#,
        );
        assert_contains(
            &rendered.html,
            r#"<pre class="highlight" data-language="bad/lang<script>"><code class="language-badlangscript">"#,
        );
        assert_contains(&rendered.html, "&lt;script&gt;alert");
        assert_contains(&rendered.html, "const value = \"&lt;raw&gt;\";");
        assert!(!rendered.html.contains("<img src"));
        assert!(!rendered.html.contains("onerror"));
        assert!(!rendered.html.contains("<script>alert"));
    }

    #[test]
    fn ignores_and_escapes_malicious_code_fence_metadata() {
        let markdown = r#"```ts title="<img src=x onerror=alert(1)>" onclick="alert(2)" {1}
const label = "<button onclick=alert(3)>copy</button>";
```"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<pre class="highlight" data-language="TypeScript"><code class="language-typescript">"#,
        );
        assert_contains(&rendered.html, "&lt;button");
        assert_contains(&rendered.html, "onclick=alert");
        assert!(!rendered.html.contains("title=&quot;"));
        assert!(!rendered.html.contains("<img"));
        assert!(!rendered.html.contains("onerror"));
        assert!(!rendered.html.contains("alert(2)"));
        assert!(!rendered.html.contains("{1}"));
    }

    #[test]
    fn escapes_code_content_and_preserves_whitespace() {
        let markdown = "```html\n\t<script>alert(1)</script>  \n<div onerror=\"bad\">x</div>\n```";

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(&rendered.html, "\t");
        assert_contains(&rendered.html, "&lt;");
        assert_contains(&rendered.html, "script");
        assert_contains(&rendered.html, "alert");
        assert!(
            rendered.html.contains("  \n") || rendered.html.contains("  \r\n"),
            "expected trailing spaces before the line break to be preserved:\n{}",
            rendered.html
        );
        assert_contains(&rendered.html, "onerror");
        assert!(!rendered.html.contains("<script>"));
        assert!(!rendered.html.contains("<div onerror"));
    }

    #[test]
    fn handles_large_and_multiple_highlighted_code_blocks() {
        let large_code = (0..300)
            .map(|index| format!("const value{index} = {index};"))
            .collect::<Vec<_>>()
            .join("\n");
        let markdown = format!(
            "```ts\n{large_code}\n```\n\n```js\nconsole.log(\"done\")\n```\n\n```nonsense\nraw\n```"
        );

        let rendered = render_markdown_document(&markdown, "README.md");

        assert_eq!(
            rendered.html.matches(r#"<pre class="highlight""#).count(),
            3
        );
        assert_contains(&rendered.html, "value299");
        assert_contains(&rendered.html, r#"data-language="TypeScript""#);
        assert_contains(&rendered.html, r#"data-language="JavaScript""#);
        assert_contains(&rendered.html, r#"data-language="nonsense""#);
    }

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
            "--bgColor-default:",
            "--bgColor-muted:",
            "--fgColor-default:",
            "--fgColor-muted:",
            "--fgColor-accent:",
            "--fgColor-success:",
            "--fgColor-attention:",
            "--fgColor-danger:",
            "--fgColor-done:",
            "--borderColor-default:",
            "--borderColor-muted:",
            "--control-bgColor-rest:",
            "--button-primary-bgColor-rest:",
            "--focus-outlineColor:",
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

        assert_contains(css, "@font-face");
        assert_contains(css, "font-family: 'Noto Sans';");
        assert_contains(css, "font-family: 'Noto Sans Mono';");
        assert_contains(css, "data:font/woff2;base64,");
        assert_contains(
            css,
            r#"[data-color-mode="light"][data-light-theme="light"]"#,
        );
        assert_contains(css, r#"[data-color-mode="auto"][data-light-theme="light"]"#);
        assert_contains(css, r#"[data-color-mode="dark"][data-dark-theme="dark"]"#);
        assert_contains(
            css,
            r#"[data-color-mode][data-color-mode="auto"][data-dark-theme="dark"]"#,
        );
        assert_contains(css, "--bgColor-default: var(--base-color-neutral-0);");
        assert_contains(css, "--fgColor-default: var(--base-color-neutral-13);");
        assert_contains(css, "--borderColor-default: var(--base-color-neutral-6);");
        assert_contains(css, "--fgColor-accent: var(--base-color-blue-5);");
        assert_contains(css, "--fgColor-success: var(--base-color-green-5);");
        assert_contains(css, "--fgColor-attention: var(--base-color-yellow-5);");
        assert_contains(css, "--fgColor-danger:");
        assert_contains(css, "--fgColor-done: var(--base-color-purple-5);");
        assert_contains(css, "--prettylights-syntax-comment:");
        assert_contains(css, "--prettylights-syntax-markup-inserted-text:");
        assert_contains(css, "/* Leaf semantic theme compiler output. */");
        assert_contains(css, "--leaf-theme-source: primer-light;");
        assert_contains(css, "--leaf-theme-source: primer-dark;");
        assert_contains(css, "--leaf-theme-source: dracula;");
        assert_contains(css, r#":root[data-leaf-theme-source="dracula"]"#);
        assert_contains(css, "--leaf-app-background: var(--bgColor-default);");
        assert_contains(
            css,
            "--leaf-syntax-comment: var(--prettylights-syntax-comment);",
        );
        assert_contains(css, "--surface-page: var(--leaf-markdown-background);");
        assert_contains(css, "--syntax-comment: var(--leaf-syntax-comment);");
        assert_contains(
            css,
            "--leaf-syntax-inserted: var(--prettylights-syntax-markup-inserted-text);",
        );
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
            "background: linear-gradient(to bottom, var(--app-surface) 0%, color-mix(in srgb, var(--app-surface) 85%, transparent) 100%);",
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
    fn app_shell_decorates_blockquote_hard_break_lines_for_hanging_indent() {
        let html = app_shell_html();

        assert_contains(&html, "function decorateBlockquoteLines(root = app) {");
        assert_contains(
            &html,
            "root.querySelectorAll('blockquote:not(.markdown-alert) p').forEach((paragraph) => {",
        );
        assert_contains(
            &html,
            "if (!children.some((node) => node.nodeName === 'BR')) return;",
        );
        assert_contains(&html, "line.className = 'blockquote-line';");
        assert_contains(&html, "paragraph.classList.add('blockquote-lines');");
        assert_contains(&html, "decorateBlockquoteLines();");
    }

    #[test]
    fn theme_compiler_requires_complete_semantic_sources_and_keeps_ui_controlled() {
        let css = reading_mode_css();
        let sources = theme_sources();

        assert_theme_sources_cover_contract(sources);
        assert_eq!(sources.len(), 3);
        assert!(sources.iter().any(|source| source.id == "dracula"));

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

        let selectable: Vec<&str> = sources
            .iter()
            .filter(|source| source.selectable)
            .map(|source| source.id)
            .collect();
        assert_eq!(selectable, vec!["primer-light", "primer-dark", "dracula"]);

        let html = app_shell_html();
        assert_contains(&html, r#"id="themeMode""#);
        assert_contains(&html, "settings.theme.");
        // Dracula is a deliberate manual choice in the theme picker.
        assert_contains(
            &html,
            r#"<option value="dracula" data-i18n="settings.theme.dracula">Dracula</option>"#,
        );
        // It activates through its own token source attribute, not free-form CSS.
        assert!(!html.contains("customTheme"));
    }

    #[test]
    fn theme_compiler_gates_readable_pairs_for_every_source() {
        let css = reading_mode_css();

        for source in theme_sources() {
            for (foreground, background) in [
                ("--leaf-app-foreground", "--leaf-app-background"),
                ("--leaf-app-muted-foreground", "--leaf-app-background"),
                ("--leaf-app-primary-foreground", "--leaf-app-primary"),
                ("--leaf-markdown-foreground", "--leaf-markdown-background"),
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
    fn app_shell_renders_interactive_document_minimap() {
        let html = app_shell_html();

        for expected in [
            "renderDocumentMinimap(state.document.minimap)",
            "function renderDocumentMinimap(model) {",
            "document-minimap-track",
            "document-minimap-content",
            "document-minimap-viewport",
            "window.leafLocale.t('minimap.aria')",
            "aria-hidden=\"true\"><div class=\"document-minimap-content\" aria-hidden=\"true\"></div><div class=\"document-minimap-viewport\" aria-hidden=\"true\"",
            "bindDocumentMinimap();",
            "function bindDocumentMinimap() {",
        ] {
            assert_contains(&html, expected);
        }

        assert!(
            !html.contains("document-minimap-mark"),
            "minimap must render a scaled document preview, not synthetic line marks"
        );
        assert!(
            !html.contains("minimapToken("),
            "minimap should not tokenize source-line categories for fake marks"
        );
    }

    #[test]
    fn app_shell_csp_allows_bundled_data_fonts() {
        // The bundled @font-face fonts are embedded as `data:` URLs. The CSP must
        // grant `font-src ... data:`, otherwise it falls back to `default-src 'self'`
        // and WebView2 silently blocks every bundled font (headings drop to Georgia,
        // body to the system sans). Guard against that regression.
        let html = app_shell_html();
        let csp_line = html
            .lines()
            .find(|line| line.contains("Content-Security-Policy"))
            .expect("shell declares a Content-Security-Policy");
        let font_src = csp_line
            .split(';')
            .map(str::trim)
            .find(|directive| directive.starts_with("font-src"))
            .expect("CSP declares an explicit font-src directive");
        assert!(
            font_src.contains("data:"),
            "font-src must allow data: URLs so bundled fonts load: {font_src}"
        );
    }

    #[test]
    fn app_shell_clones_rendered_document_into_minimap_preview() {
        let html = app_shell_html();

        for expected in [
            "let minimapPreviewFrame = 0;",
            "let minimapBodyObserver = null;",
            "let minimapResizeObserver = null;",
            "let readerLayoutFrame = 0;",
            "let readerScrollAnchor = null;",
            "scheduleMinimapPreviewUpdate();",
            "function bindDocumentMinimapPreview(track) {",
            "minimapBodyObserver = new MutationObserver(scheduleMinimapPreviewUpdate);",
            "minimapResizeObserver = new ResizeObserver(() => {",
            "scheduleReaderLayoutUpdate();",
            "function measureDocumentMinimap(track) {",
            "function measureDocumentContent(source) {",
            "function correctReaderScrollOrigin(source = app.querySelector('.document-body')) {",
            "function updateDocumentMinimapPreview() {",
            "const source = app.querySelector('.document-body');",
            "const documentContent = correctReaderScrollOrigin(source);",
            "const documentHeight = documentContent.height;",
            "const contentRect = content.getBoundingClientRect();",
            "const previewWidth = Math.max(1, Math.ceil(contentRect.width));",
            "const previewScale = previewWidth / metrics.sourceWidth;",
            "const scaledHeight = Math.max(1, metrics.scrollHeight * previewScale);",
            "const preview = source.cloneNode(true);",
            "preview.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));",
            "preview.querySelectorAll('a[href]').forEach((link) => link.removeAttribute('href'));",
            "preview.classList.add('document-minimap-preview');",
            "preview.style.width = `${metrics.sourceWidth}px`;",
            "preview.style.minHeight = `${metrics.scrollHeight}px`;",
            "preview.style.transform = `scale(${previewScale})`;",
            "content.style.height = `${scaledHeight}px`;",
            "content.replaceChildren(preview);",
            "updateMinimapViewport();",
        ] {
            assert_contains(&html, expected);
        }

        assert!(
            !html.contains("scale(${trackWidth / sourceWidth}, ${trackHeight / sourceHeight})"),
            "minimap preview must preserve document proportions with a uniform scale"
        );
        assert!(
            !html.contains("Math.min(trackWidth / sourceWidth, trackHeight / sourceHeight)"),
            "minimap preview compression must stay width-based instead of shrinking tall documents to rail height"
        );
    }

    #[test]
    fn app_shell_scales_minimap_preview_from_content_lane_not_gutter() {
        let html = app_shell_html();

        assert_contains(
            &html,
            "const contentRect = content.getBoundingClientRect();",
        );
        assert_contains(
            &html,
            "const previewWidth = Math.max(1, Math.ceil(contentRect.width));",
        );
        assert_contains(
            &html,
            "const previewScale = previewWidth / metrics.sourceWidth;",
        );
        assert_contains(
            &html,
            "const scaledHeight = Math.max(1, metrics.scrollHeight * previewScale);",
        );
        assert_contains(
            &html,
            "const viewportHeight = metrics.scrollHeight <= 0 ? metrics.trackHeight : Math.max(22, metrics.viewportHeight * previewScale);",
        );
        assert_contains(
            &html,
            "const targetViewportTop = Math.min(handleRange, Math.max(0, event.clientY - rect.top - offsetY));",
        );

        assert!(
            !html.contains("const previewScale = trackWidth / metrics.sourceWidth;"),
            "minimap preview should exclude the gutter from rail-width scale"
        );
        assert!(
            !html.contains("track.clientWidth - trackPaddingLeft"),
            "minimap preview scale must preserve both left and right padding"
        );
    }

    #[test]
    fn app_shell_loads_mermaid_and_renders_diagram_fences_after_document_insert() {
        let html = app_shell_html();

        for expected in [
            "mermaid.min.js",
            "let mermaidLoadPromise = null;",
            "renderMermaidDiagrams();",
            "function loadMermaid() {",
            "function renderMermaidDiagrams() {",
            "pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"])",
            "mermaid.initialize({",
            "securityLevel: 'strict'",
            "fontFamily: \"'Noto Sans', sans-serif\"",
            "return mermaid.run({ nodes: diagrams });",
            "diagram.dataset.mermaidRender = 'failed';",
        ] {
            assert_contains(&html, expected);
        }
        // Mermaid and KaTeX are served from the bundled-asset protocol, never a CDN.
        assert!(
            !html.contains("cdn.jsdelivr"),
            "runtimes must be self-hosted, not loaded from a CDN"
        );
        assert!(html.contains(LOCAL_ASSET_PROTOCOL));
    }

    #[test]
    fn app_shell_loads_bundled_katex_and_renders_math_after_document_insert() {
        let html = app_shell_html();

        for expected in [
            "katex/katex.min.js",
            "katex/katex.min.css",
            "let katexLoadPromise = null;",
            "function loadKatex() {",
            "function renderMathElements() {",
            "renderMathElements();",
            "node.classList.contains('math-display')",
        ] {
            assert_contains(&html, expected);
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

        let font =
            bundled_asset_response("leaf-asset://local/katex/fonts/KaTeX_Main-Regular.woff2");
        assert_eq!(font.status, 200);
        assert_eq!(font.content_type, "font/woff2");
        assert!(!font.body.is_empty());

        let missing = bundled_asset_response("leaf-asset://local/nope.js");
        assert_eq!(missing.status, 404);
    }

    #[test]
    fn app_shell_renders_history_controls_and_intercepts_document_links() {
        let html = app_shell_html();

        for expected in [
            r#"<button type="button" id="backButton""#,
            r#"<button type="button" id="forwardButton""#,
            r#"<button type="button" id="homeButton" class="brand-button" data-i18n-aria-label="actions.home" data-i18n-title="actions.home.title" aria-label="Home" title="Home">"#,
            r#"<div class="tab-bar" id="tabBar" role="tablist" aria-label="Open documents"></div>"#,
            r#"class="icon-button history-button" data-i18n-aria-label="actions.back""#,
            r#"class="icon-button history-button" data-i18n-aria-label="actions.forward""#,
            r#"<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"#,
            r#"<path d="M6.75 15.75 3 12m0 0 3.75-3.75M3 12h18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
            r#"<path d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
            r#"<path d="M18 6 6 18"/><path d="m6 6 12 12"/>"#,
            "backButton.addEventListener('click', () => sendNavigationCommand('goBack'))",
            "forwardButton.addEventListener('click', () => sendNavigationCommand('goForward'))",
            "homeButton.addEventListener('click', () => send({ command: 'goHome' }))",
            "function sendNavigationCommand(command) {",
            "function isEditableMouseTarget(target) {",
            "function navigationCommandForMouseButton(event) {",
            "event.button === 3",
            "return 'goBack';",
            "event.button === 4",
            "return 'goForward';",
            "window.addEventListener('mousedown', (event) => {",
            "event.preventDefault();",
            "const isBackShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowLeft';",
            "const isMacBackShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowLeft';",
            "event.key.toLowerCase() === 'w' && currentState.active != null",
            "send({ command: 'closeTab', index: currentState.active });",
            "send({ command: 'switchTab', index, scroll_anchor: currentScrollAnchor() });",
            "send({ command: 'closeTab', index: Number(button.dataset.tabClose) });",
            "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
            "function bindDocumentLinks() {",
            "link.removeAttribute('target');",
            "window.leafSetNavigation({ canGoBack: false, canGoForward: false });",
        ] {
            assert_contains(&html, expected);
        }

        assert!(
            !html.contains(r#"<path d="m15 18-6-6 6-6"/>"#),
            "Back button must use the vendored arrow-left icon instead of the fallback chevron"
        );

        let forward_position = html
            .find(r#"<button type="button" id="forwardButton""#)
            .expect("app shell renders forward button");
        let nav_end_position = html
            .find("</nav>")
            .expect("app shell closes history navigation");
        let tab_bar_position = html
            .find(r#"<div class="tab-bar" id="tabBar""#)
            .expect("app shell renders the open-document tab bar");

        assert!(
            forward_position < nav_end_position && nav_end_position < tab_bar_position,
            "Tab bar should follow the history navigation controls"
        );
    }

    #[test]
    fn app_shell_normalizes_literal_svg_icon_colors_to_current_color() {
        let icon = r##"<svg><path fill="#fff" stroke="#FFFFFF"/><path fill='white' stroke='none'/><path fill="#fff0eb" stroke="currentColor"/><path fill="rgb(255, 255, 255)" stroke="rebeccapurple"/><path fill-rule="evenodd"/><path style="fill:#fff; stroke: hsl(0 0% 100%); fill-opacity: 0.5"/></svg>"##;

        assert_eq!(
            normalize_svg_icon_colors(icon),
            r##"<svg><path fill="currentColor" stroke="currentColor"/><path fill='currentColor' stroke='none'/><path fill="currentColor" stroke="currentColor"/><path fill="currentColor" stroke="currentColor"/><path fill-rule="evenodd"/><path style="fill:currentColor; stroke: currentColor; fill-opacity: 0.5"/></svg>"##
        );
    }

    #[test]
    fn app_shell_preserves_tokenized_svg_icon_colors() {
        let icon = r##"<svg><path fill="var(--leaf-icon-base)" stroke='var(--leaf-icon-accent)'/><path fill="transparent" stroke="inherit"/></svg>"##;

        assert_eq!(
            normalize_svg_icon_colors(icon),
            r##"<svg><path fill="var(--leaf-icon-base)" stroke='var(--leaf-icon-accent)'/><path fill="transparent" stroke="inherit"/></svg>"##
        );
    }

    #[test]
    fn app_shell_back_icon_uses_current_color_and_keeps_no_square_fallback() {
        let html = app_shell_html();

        assert_contains(&html, r#"stroke="currentColor""#);
        assert_contains(
            &html,
            r#"<path d="M6.75 15.75 3 12m0 0 3.75-3.75M3 12h18" fill="none" stroke="currentColor""#,
        );
        assert!(
            !html.contains(r##"stroke="#fff""##)
                && !html.contains(r##"stroke="#ffffff""##)
                && !html.contains(r#"stroke="white""#),
            "app-owned icon SVGs must inherit the surrounding control color"
        );
        for hardcoded_color in [
            r##"fill="#fff0eb""##,
            r#"fill="rgb("#,
            r#"stroke="rgb("#,
            r#"fill="hsl("#,
            r#"stroke="hsl("#,
            r#"fill="black""#,
            r#"stroke="black""#,
            r#"fill="white""#,
            r#"stroke="white""#,
        ] {
            assert!(
                !html.contains(hardcoded_color),
                "app-owned icon SVGs must not contain hardcoded theme colors: {hardcoded_color}"
            );
        }
        assert!(
            !html.contains(r#"<path d="m15 18-6-6 6-6"/>"#),
            "Back button must not regress to the generic fallback chevron"
        );
    }

    #[test]
    fn app_shell_styles_history_controls_with_neutral_icon_treatment() {
        let css = reading_mode_css();

        for expected in [
            ".history-button {",
            "border-color: transparent;",
            "background: var(--settings-control-background);",
            "color: var(--settings-control-foreground);",
            ".history-button:hover:not(:disabled)",
            ".history-button:disabled,\n.history-button:disabled:hover",
            "color: var(--app-muted-foreground);",
            "opacity: 0.46;",
        ] {
            assert_contains(css, expected);
        }
    }

    #[test]
    fn app_shell_styles_open_button_like_other_secondary_toolbar_icons() {
        let css = reading_mode_css();

        for expected in [
            ".open-button {",
            "border-color: transparent;",
            "background: transparent;",
            "color: var(--app-muted-foreground);",
            ".open-button:hover {",
            "color: var(--app-action-foreground);",
        ] {
            assert_contains(css, expected);
        }
    }

    #[test]
    fn app_shell_header_uses_translucent_blur() {
        let css = reading_mode_css();

        for expected in [
            "background: linear-gradient(to bottom, var(--app-surface) 0%, color-mix(in srgb, var(--app-surface) 85%, transparent) 100%);",
            "backdrop-filter: blur(2px);",
            "-webkit-backdrop-filter: blur(2px);",
            ".app-bar::before",
            ".app-bar::after",
        ] {
            assert_contains(css, expected);
        }

        assert!(
            !css.contains("  border-bottom: 1px solid var(--app-border);"),
            "app header must not draw a hard bottom border"
        );

        assert!(
            !css.contains(".app-bar.is-scrolled"),
            "app header must not draw a drop shadow on scroll"
        );
    }

    #[test]
    fn app_shell_throttles_minimap_scroll_sync() {
        let html = app_shell_html();

        for expected in [
            "let minimapViewportFrame = 0;",
            "function scheduleMinimapViewportUpdate() {",
            "window.requestAnimationFrame(() => {",
            "function updateMinimapViewport() {",
            "app.addEventListener('scroll', () => {",
            "clampReaderScrollPosition();",
            "readerScrollAnchor = captureReaderScrollAnchor();",
            "scheduleMinimapViewportUpdate();",
            "window.addEventListener('resize', () => {",
            "scheduleReaderLayoutUpdate();",
            "scheduleMinimapViewportUpdate();",
            "scheduleMinimapPreviewUpdate();",
        ] {
            assert_contains(&html, expected);
        }
    }

    #[test]
    fn app_shell_clicks_minimap_to_scroll_document() {
        let html = app_shell_html();

        for expected in [
            "const scrollToMinimapSnapshotPoint = (event) => {",
            "const metrics = measureDocumentMinimap(track);",
            "const content = track.querySelector('.document-minimap-content');",
            "const contentRect = content ? content.getBoundingClientRect() : null;",
            "if (!contentRect || contentRect.height <= 0 || metrics.scrollHeight <= 0 || metrics.scrollable <= 0) {",
            "const previewScale = minimapPreviewScale(track, metrics);",
            "const clickedDocumentY = (event.clientY - contentRect.top) / previewScale;",
            "const targetViewportScrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));",
            "setReaderScrollTop(metrics.topOffset + targetViewportScrollTop);",
            "track.addEventListener('pointerdown', (event) => {",
            "if (Number.isFinite(minimapPointerOffsetY)) {",
            "dragMinimapViewportToPointer(event, minimapPointerOffsetY);",
            "} else {",
            "scrollToMinimapSnapshotPoint(event);",
        ] {
            assert_contains(&html, expected);
        }
    }

    #[test]
    fn app_shell_maps_minimap_clicks_against_visible_preview_snapshot() {
        let html = app_shell_html();

        let snapshot_position = html
            .find("const contentRect = content ? content.getBoundingClientRect() : null;")
            .expect("minimap clicks read the currently visible preview snapshot");
        let clicked_position = html
            .find("const clickedDocumentY = (event.clientY - contentRect.top) / previewScale;")
            .expect("minimap clicks convert the visible image/script landmark coordinate through the preview scale");
        let target_position = html
            .find("setReaderScrollTop(metrics.topOffset + targetViewportScrollTop);")
            .expect("minimap clicks scroll the reader to the clicked document landmark");
        let viewport_drag_position = html
            .find("const targetViewportTop = Math.min(handleRange, Math.max(0, event.clientY - rect.top - offsetY));")
            .expect("minimap handle dragging still clamps the target viewport position");

        assert!(
            snapshot_position < clicked_position && clicked_position < target_position,
            "clicking a visible image or Tibetan-script minimap landmark must map from the pre-scroll preview coordinate, not from the post-scroll viewport position"
        );
        assert!(
            viewport_drag_position < snapshot_position,
            "viewport drag behavior should stay separate from snapshot-based content landmark clicks"
        );
    }

    #[test]
    fn app_shell_drags_minimap_to_scroll_document() {
        let html = app_shell_html();

        for expected in [
            "let minimapPointerId = null;",
            "let minimapPointerOffsetY = null;",
            "const minimapPointerOffset = (event) => {",
            "return event.clientY - viewportRect.top;",
            "const dragMinimapViewportToPointer = (event, pointerOffsetY) => {",
            "const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, metrics);",
            "const scaledDocumentHeight = Math.max(1, metrics.scrollHeight * previewScale);",
            "const viewportHeight = metrics.scrollHeight <= 0 ? metrics.trackHeight : Math.max(22, metrics.viewportHeight * previewScale);",
            "const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);",
            "const handleRange = Math.max(0, metrics.trackHeight - boundedViewportHeight);",
            "const offsetY = Number.isFinite(pointerOffsetY) ? pointerOffsetY : boundedViewportHeight / 2;",
            "const targetViewportTop = Math.min(handleRange, Math.max(0, event.clientY - rect.top - offsetY));",
            "const previewTravel = Math.max(0, scaledDocumentHeight - metrics.trackHeight);",
            "const viewportTopPerScrollPixel = previewScale - previewTravel / metrics.scrollable;",
            "const targetViewportScrollTop = viewportTopPerScrollPixel > 0",
            "? targetViewportTop / viewportTopPerScrollPixel",
            ": (handleRange <= 0 ? 0 : (targetViewportTop / handleRange) * metrics.scrollable);",
            "setReaderScrollTop(metrics.topOffset + Math.min(metrics.scrollable, Math.max(0, targetViewportScrollTop)));",
            "minimapPointerOffsetY = minimapPointerOffset(event);",
            "track.setPointerCapture(event.pointerId);",
            "track.addEventListener('pointermove', (event) => {",
            "if (event.pointerId !== minimapPointerId) {",
            "dragMinimapViewportToPointer(event, minimapPointerOffsetY);",
            "minimapPointerOffsetY = null;",
            "track.addEventListener('pointerup', endDrag);",
            "track.addEventListener('pointercancel', endDrag);",
            "track.addEventListener('lostpointercapture', endDrag);",
        ] {
            assert_contains(&html, expected);
        }
    }

    #[test]
    fn app_shell_maps_minimap_drag_to_rendered_viewport_coordinates() {
        let html = app_shell_html();

        let drag_position = html
            .find("const dragMinimapViewportToPointer = (event, pointerOffsetY) => {")
            .expect("minimap drag handler exists");
        let preview_scale_position = html
            .find("const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, metrics);")
            .expect("drag mapping uses the live scaled preview height");
        let target_position = html
            .find("const targetViewportTop = Math.min(handleRange, Math.max(0, event.clientY - rect.top - offsetY));")
            .expect("drag mapping clamps the pointer target in minimap coordinates");
        let inverse_position = html
            .find("const viewportTopPerScrollPixel = previewScale - previewTravel / metrics.scrollable;")
            .expect("drag mapping uses the painted viewport travel model");
        let scroll_position = html
            .find("setReaderScrollTop(metrics.topOffset + Math.min(metrics.scrollable, Math.max(0, targetViewportScrollTop)));")
            .expect("drag mapping clamps reader scroll before applying the measured top offset");

        assert!(
            drag_position < preview_scale_position
                && preview_scale_position < target_position
                && target_position < inverse_position
                && inverse_position < scroll_position,
            "minimap dragging should preserve the VS Code-like handle-range mapping rather than forcing 1:1 pointer tracking"
        );
        assert!(
            !html.contains("minimapDragStartScrollTop"),
            "minimap drag should not force stable-origin 1:1 preview-coordinate tracking"
        );
    }

    #[test]
    fn app_shell_preserves_focus_and_updates_minimap_viewport_indicator() {
        let html = app_shell_html();

        for expected in [
            "const restoreFocus = () => {",
            "const active = document.activeElement;",
            "active.focus({ preventScroll: true });",
            "event.preventDefault();",
            "minimap.style.setProperty('--minimap-viewport-top'",
            "minimap.style.setProperty('--minimap-viewport-height'",
            "minimap.style.setProperty('--minimap-preview-top'",
            "updateMinimapViewport();",
        ] {
            assert_contains(&html, expected);
        }
    }

    #[test]
    fn app_shell_translates_minimap_preview_without_rescaling_on_scroll() {
        let html = app_shell_html();

        for expected in [
            "const track = minimap.querySelector('.document-minimap-track');",
            "const content = minimap.querySelector('.document-minimap-content');",
            "const metrics = measureDocumentMinimap(track);",
            "const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, metrics);",
            "const scaledDocumentHeight = Math.max(1, metrics.scrollHeight * previewScale);",
            "const scrollRatio = metrics.scrollable === 0 ? 0 : Math.min(1, Math.max(0, metrics.viewportScrollTop / metrics.scrollable));",
            "const viewportHeight = metrics.scrollHeight <= 0 ? metrics.trackHeight : Math.max(22, metrics.viewportHeight * previewScale);",
            "const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);",
            "const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);",
            "const viewportDocumentTop = metrics.viewportScrollTop * previewScale;",
            "const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));",
            "minimap.style.setProperty('--minimap-preview-top', `${previewTop}px`);",
        ] {
            assert_contains(&html, expected);
        }
    }

    #[test]
    fn app_shell_sizes_minimap_viewport_from_scaled_reader_window() {
        let html = app_shell_html();

        let preview_scale_position = html
            .find(
                "const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, metrics);",
            )
            .expect("minimap viewport derives scale from the rendered preview height");
        let viewport_height_position = html
            .find("const viewportHeight = metrics.scrollHeight <= 0 ? metrics.trackHeight : Math.max(22, metrics.viewportHeight * previewScale);")
            .expect("minimap viewport uses the scaled reader viewport height");
        let viewport_top_position = html
            .find("const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));")
            .expect("minimap viewport is positioned in scaled preview coordinates");

        assert!(
            preview_scale_position < viewport_height_position
                && viewport_height_position < viewport_top_position,
            "a tall reader viewport with a large image and adjacent text should draw a proportionally tall minimap viewport over the scaled preview, not a scrollHeight/trackHeight sliver"
        );
        assert!(
            !html.contains("(metrics.viewportHeight / metrics.scrollHeight) * metrics.trackHeight"),
            "minimap viewport height must not be tied to the rail-height ratio"
        );
    }

    #[test]
    fn app_shell_sizes_minimap_track_from_content_with_reader_viewport_cap() {
        let html = app_shell_html();

        for expected in [
            "function syncMinimapTrackHeight(minimap) {",
            "const shellRect = app.getBoundingClientRect();",
            "const minimapRect = minimap.getBoundingClientRect();",
            "const availableHeight = Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));",
            "const content = minimap.querySelector('.document-minimap-content');",
            "const contentRect = content ? content.getBoundingClientRect() : null;",
            "const contentHeight = contentRect ? Math.ceil(contentRect.height) : 0;",
            "const trackHeight = contentHeight > 0 ? Math.min(availableHeight, contentHeight) : availableHeight;",
            "minimap.style.setProperty('--minimap-track-height', `${trackHeight}px`);",
            "return { availableHeight, trackHeight };",
            "const trackSize = minimap ? syncMinimapTrackHeight(minimap) : null;",
            "const shellHeight = trackSize ? trackSize.availableHeight : Math.max(1, app.clientHeight);",
            "const documentContent = correctReaderScrollOrigin(source);",
            "const documentHeight = documentContent.height;",
            "const trackHeight = Math.max(1, Math.ceil(track.clientHeight || trackRect.height || trackSize?.trackHeight || shellHeight));",
            "const viewportHeight = Math.max(1, Math.ceil(app.clientHeight || shellHeight));",
            "const scrollRange = measureReaderScrollRange(documentContent, viewportHeight);",
            "const scrollHeight = scrollRange.scrollHeight;",
            "const scrollable = scrollRange.scrollable;",
            "const viewportScrollTop = Math.min(scrollable, Math.max(0, app.scrollTop - documentContent.topOffset));",
            "return { source, sourceWidth, documentHeight, topOffset: documentContent.topOffset, trackRect, trackHeight, viewportHeight, scrollHeight, scrollable, viewportScrollTop };",
        ] {
            assert_contains(&html, expected);
        }

        assert!(
            !html.contains("minimap.style.setProperty('--minimap-track-height', `${availableHeight}px`);"),
            "short documents should shrink the minimap track to the rendered preview height instead of always using the full reader viewport"
        );
    }

    #[test]
    fn app_shell_rebinds_minimap_after_document_updates() {
        let html = app_shell_html();

        for expected in [
            "const minimapHtml = renderDocumentMinimap(state.document.minimap);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            "app.innerHTML = `<div class=\"${layoutClass}\">${state.document.html}${minimapHtml}</div>`;",
            "bindDocumentMinimap();",
            "updateMinimapViewport();",
        ] {
            assert_contains(&html, expected);
        }
    }

    #[test]
    fn app_shell_resets_new_documents_to_rendered_content_top() {
        let html = app_shell_html();

        for expected in [
            "let resetReaderScrollOnNextRender = false;",
            "resetReaderScrollOnNextRender = true;",
            "resetReaderScrollToContentStart();",
            "function resetReaderScrollToContentStart() {",
            "const content = correctReaderScrollOrigin(source);",
            "setReaderScrollTop(content.topOffset);",
            "readerScrollAnchor = captureReaderScrollAnchor();",
            "const firstContent = source.firstElementChild;",
            "const rawTopOffset = Math.ceil(app.scrollTop + firstContentRect.top - shellRect.top);",
            "const topOffset = Math.max(0, rawTopOffset - READER_CONTENT_TOP_GAP);",
        ] {
            assert_contains(&html, expected);
        }

        assert!(
            !html.contains("app.scrollTop = 0;"),
            "new document reset should account for reader padding instead of blindly scrolling to zero"
        );
    }

    #[test]
    fn app_shell_clamps_reader_scroll_to_rendered_content_range() {
        let html = app_shell_html();

        for expected in [
            "function measureReaderScrollRange(documentContent, viewportHeight) {",
            "minScrollTop: documentContent.topOffset,",
            "maxScrollTop: documentContent.topOffset + scrollable,",
            "function readerScrollOrigin(source) {",
            "function correctReaderScrollOrigin(source = app.querySelector('.document-body')) {",
            "const nextOrigin = Math.max(0, Math.ceil(content.rawTopOffset + origin - READER_CONTENT_TOP_GAP));",
            "source.style.setProperty('--reader-scroll-origin', `${nextOrigin}px`);",
            "function clampReaderScrollTop(scrollTop) {",
            "return Math.min(range.maxScrollTop, Math.max(range.minScrollTop, nextScrollTop));",
            "function setReaderScrollTop(scrollTop) {",
            "app.scrollTop = clampReaderScrollTop(scrollTop);",
            "function clampReaderScrollPosition() {",
            "const clampedScrollTop = clampReaderScrollTop(app.scrollTop);",
            "app.addEventListener('scroll', () => {",
            "clampReaderScrollPosition();",
            "setReaderScrollTop(app.scrollTop);",
            "const scrollRange = measureReaderScrollRange(documentContent, viewportHeight);",
            "const scrollable = scrollRange.scrollable;",
        ] {
            assert_contains(&html, expected);
        }

        assert!(
            !html.contains("app.scrollTop = Math.max(0, nextScrollTop);"),
            "restored reader scroll positions must clamp to the rendered content top, not raw zero"
        );
    }

    #[test]
    fn app_shell_preserves_reader_anchor_across_layout_reflow() {
        let html = app_shell_html();

        for expected in [
            "let readerLayoutFrame = 0;",
            "let readerScrollAnchor = null;",
            "let readerReflowObserver = null;",
            "const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';",
            "function captureReaderScrollAnchor() {",
            "const blocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));",
            "return { section, block: targetIndex - (sectionIndex < 0 ? 0 : sectionIndex), offsetY };",
            "function resolveReaderAnchorElement(anchor) {",
            "function restoreReaderScrollAnchor(anchor) {",
            "setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);",
            "function scheduleReaderLayoutUpdate(anchor = readerScrollAnchor || captureReaderScrollAnchor()) {",
            "correctReaderScrollOrigin();",
            "restoreReaderScrollAnchor(anchor);",
            "readerScrollAnchor = captureReaderScrollAnchor();",
            "window.addEventListener('resize', () => {",
            "scheduleReaderLayoutUpdate();",
            // The reflow observer re-pins the anchor as images decode and grow.
            "function observeReaderReflow() {",
            "readerReflowObserver = new ResizeObserver(() => scheduleReaderLayoutUpdate());",
            "image.addEventListener('load', () => scheduleReaderLayoutUpdate(), { once: true });",
        ] {
            assert_contains(&html, expected);
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
    fn reading_mode_css_keeps_minimap_stable_wide_enough_and_responsive() {
        let css = reading_mode_css();

        for expected in [
            ".reader-layout {",
            "--reader-layout-padding-inline: var(--reader-content-pad);",
            "grid-template-columns: minmax(0, 1fr);",
            "justify-items: center;",
            "padding: 0 var(--reader-layout-padding-inline);",
            "position: relative;",
            ".reader-shell.has-document:has(.document-minimap)",
            ".reader-layout-no-minimap",
            "justify-items: center;",
            ".document-minimap {",
            "--minimap-padding-inline: 8px;",
            "--minimap-preview-width: 68px;",
            "grid-area: 1 / 1;",
            "justify-self: end;",
            "position: sticky;",
            "top: 0;",
            "--minimap-width: calc(var(--minimap-preview-width) + (var(--minimap-padding-inline) * 2));",
            "width: var(--minimap-width);",
            "margin-right: calc(-1 * (var(--reader-layout-padding-inline) + var(--minimap-width)));",
            "--minimap-preview-top: 0px;",
            "--minimap-track-height: 100%;",
            "height: var(--minimap-track-height);",
            ".document-minimap-content",
            "top: var(--minimap-preview-top);",
            "left: var(--minimap-padding-inline);",
            "right: var(--minimap-padding-inline);",
            "overflow: visible;",
            ".document-minimap-preview",
            "transform-origin: 0 0;",
            "cursor: default;",
            "touch-action: none;",
            "user-select: none;",
            "@media (max-width: 900px)",
            "--minimap-preview-width: 46px;",
        ] {
            assert_contains(css, expected);
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
            css.contains(".document-minimap-content {\n  position: absolute;\n  top: var(--minimap-preview-top);\n  right: var(--minimap-padding-inline);\n  left: var(--minimap-padding-inline);"),
            "only minimap preview content should receive the exact 8px rail padding"
        );
        assert!(
            css.contains("margin-right: calc(-1 * (var(--reader-layout-padding-inline) + var(--minimap-width)));"),
            "minimap rail must occupy the layout padding so no dead strip remains to the right of the rail"
        );
    }

    #[test]
    fn app_shell_persists_minimap_enabled_setting() {
        let html = app_shell_html();

        for expected in [
            "const minimapEnabledControl = document.getElementById('minimapEnabled');",
            "let minimapEnabled = typeof LEAF_SETTINGS.minimapEnabled === 'boolean' ? LEAF_SETTINGS.minimapEnabled : true;",
            "getEnabled: () => minimapEnabled",
            "setEnabled(nextEnabled)",
            "document.documentElement.dataset.minimapEnabled = String(minimapEnabled);",
            "window.leafMinimap.setEnabled(minimapEnabled);",
            "minimapEnabledControl.checked = window.leafMinimap.getEnabled();",
            "send({ command: 'setMinimapEnabled', enabled: minimapEnabledControl.checked });",
        ] {
            assert_contains(&html, expected);
        }

        // The host owns persistence now: no localStorage-backed settings remain.
        assert!(
            !html.contains("createBooleanStorage"),
            "settings must be persisted by the host, not the non-durable localStorage shim"
        );
    }

    #[test]
    fn app_shell_persists_and_applies_speed_reader_setting() {
        let html = app_shell_html();
        let css = reading_mode_css();

        for expected in [
            r#"<label class="setting-control setting-control-inline" for="speedReaderEnabled">"#,
            r#"<input type="checkbox" id="speedReaderEnabled" aria-label="Speed Reader" aria-describedby="speedReaderEnabledHelp">"#,
            "const speedReaderEnabledControl = document.getElementById('speedReaderEnabled');",
            "let speedReaderEnabled = LEAF_SETTINGS.speedReaderEnabled === true;",
            "function setSpeedReaderEnabled(enabled) {",
            "document.documentElement.dataset.speedReader = String(speedReaderEnabled);",
            "send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });",
            "applySpeedReaderToDocument();",
            "function leadAnchorPrefixLength(count) {",
            "anchor.className = 'speed-reader-anchor';",
            "speedReaderEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.speedReader.aria'));",
        ] {
            assert_contains(&html, expected);
        }

        for expected in [
            r#":root[data-speed-reader="true"] .document-body a,"#,
            "color: inherit;",
            "text-decoration: none;",
            r#":root[data-speed-reader="true"] .document-body a:hover,"#,
            "color: var(--markdown-link-hover);",
            r#":root[data-speed-reader="true"] .document-body .speed-reader-anchor"#,
            "font-weight: 700;",
        ] {
            assert_contains(css, expected);
        }
    }

    #[test]
    fn app_shell_disables_minimap_without_leaving_empty_layout_column() {
        let html = app_shell_html();

        for expected in [
            "if (!window.leafMinimap.getEnabled()) {\n    return '';\n  }",
            "const minimapHtml = renderDocumentMinimap(state.document.minimap);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            "app.innerHTML = `<div class=\"${layoutClass}\">${state.document.html}${minimapHtml}</div>`;",
        ] {
            assert_contains(&html, expected);
        }

        let css = reading_mode_css();
        assert_contains(css, ".reader-layout-no-minimap {");
        assert_contains(css, "grid-template-columns: minmax(0, 1fr);");
        assert_contains(css, "justify-items: center;");
        assert!(!css.contains("grid-template-columns: minmax(0, var(--document-measure)) 136px;"));
    }

    #[test]
    fn app_shell_labels_minimap_setting_and_hides_decorative_marks_from_accessibility() {
        let html = app_shell_html();

        for expected in [
            r#"<label class="setting-control setting-control-inline" for="minimapEnabled">"#,
            r#"<input type="checkbox" id="minimapEnabled" aria-label="Show document minimap" aria-describedby="minimapEnabledHelp">"#,
            r#"<span class="setting-help" id="minimapEnabledHelp" data-i18n="settings.minimap.help">Show a scrollable document overview on wider windows.</span>"#,
            "minimapEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.minimap.aria'));",
            "aria-label=\"${escapeAttr(window.leafLocale.t('minimap.aria'))}\"",
            "document-minimap-track\" aria-hidden=\"true\"",
            "document-minimap-content\" aria-hidden=\"true\"",
            "document-minimap-viewport\" aria-hidden=\"true\"",
            "preview.setAttribute('aria-hidden', 'true');",
        ] {
            assert_contains(&html, expected);
        }

        assert!(
            !html.contains("document-minimap-track\" tabindex"),
            "minimap track should not enter the tab order"
        );
        assert!(
            !html.contains("document-minimap\" tabindex"),
            "minimap aside should not enter the tab order"
        );
    }

    #[test]
    fn app_shell_reacts_to_minimap_and_theme_settings() {
        let html = app_shell_html();

        let minimap_subscription_position = html
            .find("window.leafMinimap.subscribe((enabled) => {")
            .expect("app shell subscribes to minimap changes");
        let minimap_render_position = html
            .find("minimapEnabledControl.checked = enabled;\n  renderState();")
            .expect("minimap subscription rerenders document state");

        assert!(
            minimap_subscription_position < minimap_render_position,
            "minimap visibility should remain a WebView setting"
        );
        assert_contains(&html, "themeModeControl");
        assert_contains(&html, "window.leafTheme.subscribe((theme) => {");
        assert_contains(&html, "window.leafTheme.setMode(themeModeControl.value)");
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

    #[test]
    fn app_shell_theme_bootstrap_supports_system_light_dark_modes() {
        let html = app_shell_html();

        assert_contains(&html, r#"<meta name="color-scheme" content="light dark">"#);
        assert_contains(
            &html,
            "VALID_MODES = new Set(['system', 'light', 'dark', 'dracula'])",
        );
        // Seeded from the host-injected global, not localStorage (non-durable here).
        assert_contains(&html, "window.__leafSettings.themeMode");
        assert_contains(&html, "let mode = normalizeMode(injected);");
        assert_contains(
            &html,
            "root.dataset.colorMode = mode === 'system' ? 'auto' : (mode === 'dracula' ? 'dark' : mode)",
        );
        // Dracula flips on its own token source; other modes clear it.
        assert_contains(&html, "root.dataset.leafThemeSource = 'dracula'");
        assert_contains(&html, "delete root.dataset.leafThemeSource");
        assert_contains(&html, "root.dataset.lightTheme = 'light'");
        assert_contains(&html, "root.dataset.darkTheme = 'dark'");
        assert_contains(
            &html,
            "root.dataset.resolvedColorMode = theme.resolvedTheme",
        );
        assert_contains(&html, "root.dataset.themeMode = mode");
        assert_contains(&html, "root.dataset.theme = theme.resolvedTheme");
        assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme");
        assert_contains(&html, "getMode: () => mode");
        assert_contains(&html, "getResolvedTheme: resolvedTheme");
        assert_contains(&html, "mode = normalizeMode(nextMode);");
        assert_contains(&html, "subscribe(listener)");
        assert_contains(&html, "listeners.forEach((listener) => listener(theme))");
        assert_contains(
            &html,
            "media.addEventListener('change', onSystemThemeChange)",
        );
        assert_contains(&html, "media.addListener(onSystemThemeChange)");
        assert_contains(&html, "catch (_) {}");
        assert_contains(&html, r#"id="themeMode""#);
        assert_contains(&html, "settings.theme.");
        assert!(!html.contains("themeVariant"));
        assert!(!html.contains("customTheme"));
        assert!(!html.contains("id=\"lightTheme\""));
        assert!(!html.contains("id=\"darkTheme\""));
        assert!(!html.contains("getLightTheme"));
        assert!(!html.contains("getDarkTheme"));
    }

    #[test]
    fn app_shell_groups_settings_menu_with_accessible_descriptions() {
        let html = app_shell_html();

        assert_contains(
            &html,
            r#"<details class="settings-menu" id="settingsMenu">"#,
        );
        assert_contains(
            &html,
            r#"<summary id="settingsSummary" class="icon-button" data-i18n-aria-label="settings.heading" data-i18n-title="settings.heading" aria-label="Settings" title="Settings">"#,
        );
        assert_contains(
            &html,
            r#"<path d="M6 13.5V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 9.75V10.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
        );
        assert_contains(
            &html,
            r#"<div class="settings-panel" role="group" aria-labelledby="settingsSummary">"#,
        );
        assert_contains(
            &html,
            r#"<span class="setting-help" id="themeModeHelp" data-i18n="settings.theme.help">System follows device preference.</span>"#,
        );
        assert_contains(
            &html,
            r#"<span class="setting-help" id="minimapEnabledHelp" data-i18n="settings.minimap.help">Show a scrollable document overview on wider windows.</span>"#,
        );
        assert_contains(
            &html,
            "const settingsMenu = document.getElementById('settingsMenu');",
        );
        assert_contains(&html, "if (event.key === 'Escape')");
        assert_contains(&html, "settingsMenu.querySelector('summary').focus();");
        assert_contains(
            &html,
            "if (settingsMenu.open && !settingsMenu.contains(event.target))",
        );
        assert_contains(&html, r#"for="themeMode""#);
        assert_contains(&html, "themeModeHelp");
        assert!(!html.contains("localeModeHelp"));
        assert!(!html.contains(r#"for="localeMode""#));
    }

    #[test]
    fn app_shell_keeps_settings_menu_keyboard_and_pointer_polish() {
        let html = app_shell_html();

        for expected in [
            "settingsMenu.addEventListener('keydown', (event) => {",
            "if (event.key === 'Escape') {",
            "settingsMenu.open = false;",
            "settingsMenu.querySelector('summary').focus();",
            "document.addEventListener('click', (event) => {",
            "if (settingsMenu.open && !settingsMenu.contains(event.target)) {",
            "minimapEnabledControl.addEventListener('change'",
        ] {
            assert_contains(&html, expected);
        }

        let css = reading_mode_css();

        for expected in [
            ".settings-menu summary::-webkit-details-marker",
            ".settings-panel {",
            ".setting-control-inline",
            ".setting-control-inline input",
            "input:focus-visible",
            "right: 0;",
            "width: min(290px, calc(100vw - 28px));",
            "summary:focus-visible",
            ".icon-button {",
            "place-items: center;",
            "min-width: 34px;",
        ] {
            assert_contains(css, expected);
        }
    }

    #[test]
    fn app_shell_theme_bootstrap_resolves_manual_and_system_modes() {
        let html = app_shell_html();

        assert_contains(&html, "if (mode === 'light') return 'light';");
        assert_contains(
            &html,
            "if (mode === 'dark' || mode === 'dracula') return 'dark';",
        );
        assert_contains(&html, "return media && media.matches ? 'dark' : 'light';");
        assert_contains(&html, "setMode(nextMode) {");
        assert_contains(
            &html,
            "const onSystemThemeChange = () => { if (mode === 'system') { apply(); } };",
        );
        assert_contains(
            &html,
            "root.dataset.colorMode = mode === 'system' ? 'auto' : (mode === 'dracula' ? 'dark' : mode);",
        );
        assert_contains(&html, "root.dataset.lightTheme = 'light';");
        assert_contains(&html, "root.dataset.darkTheme = 'dark';");
        assert_contains(
            &html,
            "root.dataset.resolvedColorMode = theme.resolvedTheme;",
        );
        assert_contains(&html, "root.dataset.themeMode = mode;");
        assert_contains(&html, "root.dataset.theme = theme.resolvedTheme;");
        assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme;");
    }

    #[test]
    fn app_shell_theme_bootstrap_seeds_from_host_injected_settings() {
        let html = app_shell_html();

        for expected in [
            "const VALID_MODES = new Set(['system', 'light', 'dark', 'dracula']);",
            "window.__leafSettings.themeMode",
            "let mode = normalizeMode(injected);",
            "mode = normalizeMode(nextMode);",
            "listeners.forEach((listener) => listener(theme));",
        ] {
            assert_contains(&html, expected);
        }

        // The theme path no longer touches the non-durable localStorage shim
        // (its 'leaf.themeMode' key and modeStorage are gone); the host owns
        // persistence via the setThemeMode IPC message. (The locale bootstrap
        // keeps its own separate storage, so we check theme-specific markers.)
        assert!(!html.contains("leaf.themeMode"));
        assert!(!html.contains("modeStorage"));
        assert!(html.contains("send({ command: 'setThemeMode', mode: themeModeControl.value });"));
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
    fn locale_modes_resolve_and_fallback_safely() {
        assert_eq!(LocaleMode::parse("system"), Some(LocaleMode::System));
        assert_eq!(LocaleMode::parse("en"), Some(LocaleMode::En));
        assert_eq!(LocaleMode::parse("zh-CN"), Some(LocaleMode::ZhCn));
        assert_eq!(LocaleMode::parse("zh-cn"), None);
        assert_eq!(LocaleMode::parse_or_system(Some("en")), LocaleMode::En);
        assert_eq!(
            LocaleMode::parse_or_system(Some("not-a-locale")),
            LocaleMode::System
        );
        assert_eq!(LocaleMode::parse_or_system(None), LocaleMode::System);
        assert_eq!(LocaleMode::System.storage_value(), "system");
        assert_eq!(LocaleMode::En.storage_value(), "en");
        assert_eq!(LocaleMode::ZhCn.storage_value(), "zh-CN");
        assert_eq!(
            LocaleMode::System.resolve(Some("zh-Hans")),
            ResolvedLocale::ZhCn
        );
        assert_eq!(
            LocaleMode::System.resolve(Some("zhHans")),
            ResolvedLocale::ZhCn
        );
        assert_eq!(
            LocaleMode::System.resolve(Some("zh-TW")),
            ResolvedLocale::ZhCn
        );
        assert_eq!(
            LocaleMode::System.resolve(Some("en-US")),
            ResolvedLocale::En
        );
        assert_eq!(LocaleMode::System.resolve(None).lang(), "en");
    }

    #[test]
    fn app_shell_locale_persistence_adapter_normalizes_state_transitions() {
        let html = app_shell_html();

        for expected in [
            "const STORAGE_KEY = 'leaf.localeMode';",
            "const MODE_FALLBACK = 'system';",
            "const createModeStorage = (storageKey) => ({",
            "const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);",
            "const storage = createModeStorage(STORAGE_KEY);\n  let mode = normalizeMode(storage.read());",
            "mode = normalizeMode(nextMode);\n      storage.write(mode);\n      apply();",
            "window.addEventListener('languagechange', () => {",
            "if (mode === 'system') {\n      apply();\n    }",
        ] {
            assert_contains(&html, expected);
        }
    }

    #[test]
    fn app_shell_exposes_locale_settings_translations_and_ime_guard() {
        let html = app_shell_html();

        assert_contains(&html, "leaf.localeMode");
        assert_contains(&html, "VALID_MODES = new Set(['system', 'en', 'zh-CN'])");
        assert_contains(&html, "root.lang = locale.resolvedLocale");
        assert_contains(&html, "root.dataset.localeMode = locale.mode");
        assert_contains(&html, "root.dataset.locale = locale.resolvedLocale");
        assert_contains(&html, "let mode = normalizeMode(storage.read());");
        assert_contains(&html, "mode = normalizeMode(nextMode);");
        assert_contains(&html, "const TRANSLATIONS = {");
        assert_contains(&html, "'actions.open': 'Open'");
        assert_contains(&html, "'actions.close': 'Close file'");
        assert_contains(&html, "'actions.open': '打开'");
        assert_contains(&html, "'actions.close': '关闭文件'");
        assert_contains(&html, "'settings.heading': 'Settings'");
        assert_contains(&html, "'settings.heading': '设置'");
        assert_contains(&html, "'settings.theme.label': 'Theme'");
        assert_contains(&html, "'settings.theme.system': 'System'");
        assert_contains(&html, "'settings.theme.light': 'Light'");
        assert_contains(&html, "'settings.theme.dark': 'Dark'");
        assert_contains(
            &html,
            "'errors.openFailed': 'Failed to open {path}: {reason}'",
        );
        assert_contains(&html, "'errors.openFailed': '无法打开 {path}：{reason}'");
        assert_contains(&html, "TRANSLATIONS.en[key] || key");
        assert_contains(&html, "Object.prototype.hasOwnProperty.call(values, name)");
        assert_contains(&html, "new Intl.NumberFormat(resolveLocale(), options)");
        assert_contains(&html, "new Intl.DateTimeFormat(resolveLocale(), options)");
        assert_contains(
            &html,
            "new Intl.RelativeTimeFormat(resolveLocale(), options)",
        );
        assert_contains(&html, "formatFileSize(bytes)");
        assert_contains(&html, "window.addEventListener('compositionstart'");
        assert_contains(&html, "window.addEventListener('compositionupdate'");
        assert_contains(&html, "window.addEventListener('compositionend'");
        assert_contains(&html, "if (event.isComposing || composing)");
        assert_contains(&html, "renderState();");
        assert_contains(&html, "state.document.html");
    }

    #[test]
    fn app_shell_initializes_reader_state_before_locale_subscription_renders() {
        let html = app_shell_html();
        let state_position = html
            .find("let currentState = { recent: [], tabs: [], active: null, document: null };")
            .expect("app shell declares reader state");
        let locale_subscription_position = html
            .find("window.leafLocale.subscribe(() => {")
            .expect("app shell subscribes to locale changes");

        assert!(
            state_position < locale_subscription_position,
            "locale subscription renders immediately, so reader state must exist first"
        );
    }

    #[test]
    fn app_shell_locale_bootstrap_keeps_initial_text_nonblank() {
        let html = app_shell_html();

        let subscription_position = html
            .find("window.leafLocale.subscribe(() => {")
            .expect("app shell subscribes to locale changes");
        let static_text_position = html
            .find("  renderStaticText();")
            .expect("locale subscription refreshes static text");
        let state_render_position = html
            .find("  renderState();")
            .expect("locale subscription renders reader state");
        let initial_state_position = html
            .find(
                "window.leafSetState(window.__leafInitialState || { recent: [], document: null });",
            )
            .expect("app shell renders the initial empty state");

        assert!(
            subscription_position < static_text_position
                && static_text_position < state_render_position
                && state_render_position < initial_state_position,
            "locale bootstrap must refresh shell copy before the initial empty state render"
        );

        for expected in [
            "'actions.open': 'Open'",
            "'actions.chooseFile': 'Choose file'",
            "'actions.close': 'Close file'",
            "'empty.description': 'Open any Markdown file for a calm, focused read. Turn over a new leaf.'",
            "'empty.kicker': 'Leaf Text'",
            "'empty.title': 'Markdown, made to read.'",
            "'empty.noRecent': 'Recent files will appear here after you open a document.'",
            "'settings.heading': 'Settings'",
            "TRANSLATIONS.en[key] || key",
        ] {
            assert_contains(&html, expected);
        }
    }

    #[test]
    fn app_shell_routes_fragment_links_through_reader_anchor_scrolling() {
        let html = app_shell_html();

        assert_contains(&html, "window.leafScrollToFragment = (fragment) => {");
        assert_contains(
            &html,
            "const target = document.getElementById(decoded) || document.getElementById(raw);",
        );
        assert_contains(&html, "target.focus({ preventScroll: true });");
        assert_contains(&html, "function sameDocumentFragmentHref(rawHref) {");
        assert_contains(&html, "if (rawHref.startsWith('#')) {");
        assert_contains(&html, "if (rawHref.startsWith('./#')) {");
        assert_contains(&html, "return rawHref.slice(2);");
        assert_contains(&html, "if (rawHref.startsWith('.#')) {");
        assert_contains(&html, "return rawHref.slice(1);");
        assert_contains(
            &html,
            "const fragmentHref = sameDocumentFragmentHref(rawHref);",
        );
        assert_contains(&html, "if (fragmentHref) {");
        assert_contains(&html, "event.preventDefault();");
        assert_contains(
            &html,
            "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
        );
        assert_contains(
            &html,
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
        );
        assert!(
            html.contains("if (fragmentHref) {")
                && html.contains("send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });")
                && html.contains("send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });"),
            "fragment-only links must be sent through app navigation before non-fragment links are routed"
        );
    }

    #[test]
    fn app_shell_preserves_external_link_routing_for_native_opening() {
        let html = app_shell_html();

        assert_contains(
            &html,
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
        );
        assert!(
            !html.contains(
                "send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor() });"
            ),
            "external and local non-fragment links need the resolved href for native routing"
        );
    }

    #[test]
    fn app_shell_routes_in_page_history_through_app_navigation() {
        let html = app_shell_html();

        for expected in [
            "function sendNavigationCommand(command) {",
            "send({ command, scroll_anchor: currentScrollAnchor() });",
            "backButton.disabled = !navigationState.canGoBack;",
            "forwardButton.disabled = !navigationState.canGoForward;",
            "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
        ] {
            assert_contains(&html, expected);
        }

        for removed in [
            "let inPageHistory = { back: [], forward: [] };",
            "window.history.back();",
            "window.history.forward();",
            "window.history.pushState(null, '', fragmentHref);",
            "window.addEventListener('popstate', handleInPageHistoryTraversal);",
        ] {
            assert!(
                !html.contains(removed),
                "in-page navigation must be handled by app history instead of browser history: {removed}"
            );
        }
    }

    #[test]
    fn renders_gfm_tables_strikethrough_task_lists_and_autolinks() {
        let markdown = r#"| Left | Center | Right |
| :--- | :----: | ----: |
| a | b | c |

~~struck~~

- [ ] unchecked
- [x] checked lower
- [X] checked upper

Visit https://example.com/path?q=1 and www.example.org or email leaf@example.com.

Already linked [https://example.net](https://example.net) stays one link.
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(&rendered.html, "<table>");
        assert_contains(&rendered.html, "<th>Left</th>");
        assert_contains(&rendered.html, "<th>Center</th>");
        assert_contains(&rendered.html, "<th>Right</th>");
        assert!(!rendered.html.contains("style="));
        assert_contains(&rendered.html, "<del>struck</del>");
        assert_contains(&rendered.html, r#"<input disabled="" type="checkbox">"#);
        assert_contains(&rendered.html, "unchecked</li>");
        assert_contains(
            &rendered.html,
            r#"<input disabled="" type="checkbox" checked="">"#,
        );
        assert_contains(&rendered.html, "checked lower</li>");
        assert_contains(&rendered.html, "checked upper</li>");
        assert_contains(
            &rendered.html,
            r#"<a href="https://example.com/path?q=1" rel="noopener noreferrer">https://example.com/path?q=1</a>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<a href="http://www.example.org" rel="noopener noreferrer">www.example.org</a>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<a href="mailto:leaf@example.com" rel="noopener noreferrer">leaf@example.com</a>"#,
        );
        assert_eq!(rendered.html.matches("https://example.net").count(), 2);
    }

    #[test]
    fn renders_github_issue_pull_request_and_commit_references_with_context() {
        let markdown = "Fixes #123, GH-456, ryanallen/leaf#789, and a1b2c3d.";

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<a class="github-ref issue-ref" href="https://github.com/ryanallen/leaftext/issues/123" rel="noopener noreferrer">#123</a>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<a class="github-ref issue-ref" href="https://github.com/ryanallen/leaftext/issues/456" rel="noopener noreferrer">GH-456</a>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<a class="github-ref issue-ref" href="https://github.com/ryanallen/leaf/issues/789" rel="noopener noreferrer">ryanallen/leaf#789</a>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<a class="github-ref commit-ref" href="https://github.com/ryanallen/leaftext/commit/a1b2c3d" rel="noopener noreferrer"><code>a1b2c3d</code></a>"#,
        );
    }

    #[test]
    fn preserves_repository_scoped_references_without_context() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-no-git-{unique}"));
        fs::create_dir_all(&dir).expect("test directory is created");

        let rendered = render_markdown_document("#1 GH-2 a1b2c3d", dir.join("README.md"));
        fs::remove_dir_all(&dir).expect("test directory is removed");

        assert_contains(&rendered.html, "<p>#1 GH-2 a1b2c3d</p>");
        assert!(!rendered.html.contains("github-ref"));
        assert!(!rendered.html.contains("commit-ref"));
    }

    #[test]
    fn renders_mentions_and_supported_emoji_shortcodes() {
        let markdown = "Thanks @octocat and @github/docs for :shipit: while :unknown: stays.";

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<span class="github-mention">@octocat</span>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<span class="github-mention">@github/docs</span>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<span class="emoji" title=":shipit:" aria-label=":shipit:">🚢</span>"#,
        );
        assert_contains(&rendered.html, ":unknown: stays");
    }

    #[test]
    fn renders_footnotes_with_backlinks() {
        let markdown = "Footnote here.[^one]\n\n[^one]: Backlinked note.";

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r##"<sup class="footnote-reference" id="fnref-one"><a href="#one" rel="noopener noreferrer">1</a></sup>"##,
        );
        assert_contains(
            &rendered.html,
            r#"<div class="footnote-definition" id="one">"#,
        );
        assert_contains(
            &rendered.html,
            r##"<a class="footnote-backref" href="#fnref-one" aria-label="Back to content" rel="noopener noreferrer"><svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"##,
        );
        assert_contains(
            &rendered.html,
            r#"<path d="M9.3,15.1l-6-6M3.3,9.1l6-6M3.3,9.1h12c3.3,0,6,2.7,6,6s-2.7,6-6,6h-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>"#,
        );
        assert!(
            !rendered.html.contains(r#">↩</a>"#),
            "footnote backlinks should render the provided SVG icon instead of the text fallback"
        );
        assert_contains(&rendered.html, "Backlinked note.");
    }

    #[test]
    fn footnote_definitions_collect_at_the_end_in_reference_order() {
        // Definitions sit mid-document with a section after them, and the notes
        // are referenced in the opposite order to how they are defined.
        let markdown = "First reference.[^second]\n\nSecond reference.[^first]\n\n\
             [^first]: Defined first.\n[^second]: Defined second.\n\n## Later\n\nTrailing prose.";

        let rendered = render_markdown_document(markdown, "README.md");
        let html = &rendered.html;

        let trailing = html
            .find("Trailing prose.")
            .expect("trailing prose rendered");
        let second_def = html
            .find(r#"<div class="footnote-definition" id="second">"#)
            .expect("second footnote definition rendered");
        let first_def = html
            .find(r#"<div class="footnote-definition" id="first">"#)
            .expect("first footnote definition rendered");

        // Both definitions are hoisted below the later section, not left where
        // they were written in the source.
        assert!(
            trailing < second_def && trailing < first_def,
            "footnote definitions should collect after the rest of the document"
        );
        // Ordered by first reference: [^second] is referenced before [^first].
        assert!(
            second_def < first_def,
            "footnote definitions should be ordered by first reference"
        );

        // Reference numbers follow the same first-referenced-first order.
        assert_contains(
            html,
            r##"<sup class="footnote-reference" id="fnref-second"><a href="#second" rel="noopener noreferrer">1</a></sup>"##,
        );
        assert_contains(
            html,
            r##"<sup class="footnote-reference" id="fnref-first"><a href="#first" rel="noopener noreferrer">2</a></sup>"##,
        );
    }

    #[test]
    fn renders_github_alert_callouts() {
        let markdown = r#"> [!NOTE]
> Useful context.

> [!TIP]
> Try this.

> [!IMPORTANT]
> Required.

> [!WARNING]
> Risky.

> [!CAUTION]
> Dangerous.
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        for class_name in [
            "markdown-alert-note",
            "markdown-alert-tip",
            "markdown-alert-important",
            "markdown-alert-warning",
            "markdown-alert-caution",
        ] {
            assert_contains(
                &rendered.html,
                &format!(r#"<blockquote class="{class_name}">"#),
            );
        }
    }

    #[test]
    fn renders_mermaid_and_math_with_readable_fallback_markup() {
        let markdown = r#"```mermaid
graph TD
    A --> B
```

Inline $a^2 + b^2 = c^2$.

$$
\int_0^1 x dx
$$
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<pre class="mermaid" data-language="mermaid">graph TD"#,
        );
        assert_contains(
            &rendered.html,
            r#"<span class="math math-inline">a^2 + b^2 = c^2</span>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<span class="math math-display">\int_0^1 x dx</span>"#,
        );
    }

    #[test]
    fn renders_mermaid_xychart_frontmatter_for_webview_runtime() {
        let markdown = r#"```mermaid
---
config:
  xyChart:
    width: 700
    height: 500
    xAxis:
      labelPadding: 20
    yAxis:
      labelPadding: 40
    themeVariables:
      xyChart:
        backgroundColor: transparent
---
xychart-beta
  title "Component Adoption %"
  x-axis ["portal-ui", "contractor", "auth-ui", "acwa-ui", "ramp-ui"]
  y-axis "Adoption %" 0 --> 100
  bar [100, 93.1, 73.9, 48.8, 20.0]
```"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<pre class="mermaid" data-language="mermaid">xychart-beta"#,
        );
        assert_contains(&rendered.html, "xychart-beta");
        assert_contains(&rendered.html, r#"title "Component Adoption %""#);
        assert_contains(&rendered.html, "0 --&gt; 100");
        assert!(!rendered.html.contains("---\nconfig:"));
        assert!(!rendered
            .html
            .contains(r#"<pre class="highlight" data-language="mermaid""#));
    }

    #[test]
    fn renders_mermaid_block_beta_after_init_directive_for_webview_runtime() {
        let markdown = r##"```mermaid
%%{init: {theme: "base"}}%%
block-beta
  columns 3
  block:legend:1
    rows 2
    lg["🟩 Core Health"]
  end
  aw2["App Worker"]
  style aw2 fill:#34a853,color:#fff
```"##;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(
            &rendered.html,
            r#"<pre class="mermaid" data-language="mermaid">%%{init: {theme: "base"}}%%"#,
        );
        assert_contains(&rendered.html, "block-beta");
        assert_contains(&rendered.html, "block:legend:1");
        assert_contains(&rendered.html, "lg[\"🟩 Core Health\"]");
        assert_contains(&rendered.html, "style aw2 fill:#34a853,color:#fff");
        assert!(!rendered
            .html
            .contains(r#"<pre class="highlight" data-language="mermaid""#));
        assert!(!rendered.html.contains("language-mermaid"));
    }

    #[test]
    fn strips_disallowed_raw_html_tags_and_attributes() {
        let markdown = r#"<details open onclick="alert(1)">
<summary>Deploy notes</summary>
<p style="color:red"><a href="javascript:alert(2)" onclick="bad()">bad</a> <a href="https://example.com" title="Example" target="_blank">good</a></p>
<span class="badge" title="dropped title">Span text</span>
</details>"#;

        let rendered = render_markdown_document(markdown, "README.md");

        // `<details>`/`<summary>` are allowed and the boolean `open` is kept (the
        // sanitizer normalizes it to `open=""`, which browsers treat as expanded),
        // but the dangerous bits (onclick, style, target, javascript:, class) go.
        assert_contains(&rendered.html, r#"<details open="">"#);
        assert_contains(&rendered.html, "<summary>Deploy notes</summary>");
        assert!(!rendered.html.contains("onclick"));
        assert!(!rendered.html.contains("target="));
        assert!(!rendered.html.contains("style="));
        assert!(!rendered.html.contains("badge"));
        assert!(!rendered.html.contains("javascript:"));
        assert_contains(&rendered.html, r#"<a rel="noopener noreferrer">bad</a>"#);
        assert_contains(
            &rendered.html,
            r#"<a href="https://example.com" title="Example" rel="noopener noreferrer">good</a>"#,
        );
        assert_contains(&rendered.html, "<span>Span text</span>");
    }

    #[test]
    fn renders_allowed_raw_markdown_html_tags_and_safe_attributes() {
        let markdown = r#"<div align="center">
<img src="images/logo.png" alt="Leaf logo" title="Logo" width="96">
<h1>Leaf</h1>
<p><span>A calm <strong>Markdown</strong> reader.</span></p>
<p><a href="https://example.com">Website</a><br>Local docs below.</p>
<hr>
<ul><li>One</li></ul>
<ol><li>Two</li></ol>
<pre><code>raw code</code></pre>
<table>
<thead><tr><th colspan="2" style="text-align:center">Head</th></tr></thead>
<tbody><tr><td colspan="2" data-extra="no">Cell</td></tr></tbody>
</table>
</div>

## Features

Markdown still works around raw HTML with **emphasis** and [relative links](docs/index.html).

| Item | Status |
| --- | --- |
| HTML | supported |

> Blockquotes continue to render.
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_contains(&rendered.html, r#"<div align="center">"#);
        assert_contains(
            &rendered.html,
            r#"<img src="images/logo.png" alt="Leaf logo" title="Logo">"#,
        );
        assert_contains(
            &rendered.html,
            "<span>A calm <strong>Markdown</strong> reader.</span>",
        );
        assert_contains(
            &rendered.html,
            r#"<a href="https://example.com" rel="noopener noreferrer">Website</a><br>Local docs below."#,
        );
        assert_contains(&rendered.html, "<hr>");
        assert_contains(&rendered.html, "<ul><li>One</li></ul>");
        assert_contains(&rendered.html, "<ol><li>Two</li></ol>");
        assert_contains(&rendered.html, "<pre><code>raw code</code></pre>");
        assert_contains(&rendered.html, r#"<th colspan="2">Head</th>"#);
        assert_contains(&rendered.html, r#"<td colspan="2">Cell</td>"#);
        assert_contains(&rendered.html, r#"<h2 id="features">Features</h2>"#);
        assert_contains(&rendered.html, "<strong>emphasis</strong>");
        assert_contains(
            &rendered.html,
            r#"<a href="docs/index.html" rel="noopener noreferrer">relative links</a>"#,
        );
        assert_contains(&rendered.html, "<table>");
        assert_contains(&rendered.html, "<blockquote>");
        assert!(!rendered.html.contains("width="));
        assert!(!rendered.html.contains("style="));
        assert!(!rendered.html.contains("data-extra"));
    }

    #[test]
    fn renders_collapsible_and_safe_inline_raw_html() {
        let markdown = r#"<details open>
<summary>Click to expand</summary>

Hidden content with a <kbd>Ctrl</kbd> key.

</details>

Water is H<sub>2</sub>O and 2<sup>10</sup> = 1024. Some <mark>highlight</mark>,
<ins>inserted</ins>, <s>struck</s>, and an <abbr title="HyperText">HTML</abbr> note.

<dl><dt>Term</dt><dd>Definition</dd></dl>

<figure><figcaption>A caption</figcaption></figure>
"#;

        let rendered = render_markdown_document(markdown, "README.md");

        for needle in [
            r#"<details open="">"#,
            "<summary>Click to expand</summary>",
            "<kbd>Ctrl</kbd>",
            "H<sub>2</sub>O",
            "2<sup>10</sup>",
            "<mark>highlight</mark>",
            "<ins>inserted</ins>",
            "<s>struck</s>",
            r#"<abbr title="HyperText">HTML</abbr>"#,
            "<dl><dt>Term</dt><dd>Definition</dd></dl>",
            "<figure><figcaption>A caption</figcaption></figure>",
        ] {
            assert_contains(&rendered.html, needle);
        }
    }

    #[test]
    fn preserves_safe_raw_html_alignment_in_markdown_headings() {
        let markdown = r##"# <div align="center">Words of My Perfect Teacher</div>
<div align="center">A Complete Translation of a Classic Introduction to Tibetan Buddhism</div>
<div align="RIGHT" onclick="bad()">by <a href="#patrul-rinpoche">Patrul Rinpoche</a></div>
<div align="expression(alert(1))">not aligned</div>"##;

        let rendered = render_markdown_document(markdown, "README.md");

        assert_eq!(rendered.title, "Words of My Perfect Teacher");
        assert_contains(
            &rendered.html,
            r#"<div align="center">Words of My Perfect Teacher</div>"#,
        );
        assert_contains(
            &rendered.html,
            r#"<div align="center">A Complete Translation of a Classic Introduction to Tibetan Buddhism</div>"#,
        );
        assert_contains(
            &rendered.html,
            r##"<div align="right">by <a href="#patrul-rinpoche" rel="noopener noreferrer">Patrul Rinpoche</a></div>"##,
        );
        assert_contains(&rendered.html, "<div>not aligned</div>");
        assert!(!rendered.html.contains("onclick"));
        assert!(!rendered.html.contains("expression(alert(1))"));
    }

    #[test]
    fn resolves_relative_media_against_source_file_directory() {
        let markdown = "![Leaf logo](assets/logo.svg)";
        let source_path = fixture_source_path("project/README.md");

        let rendered = render_markdown_document(markdown, &source_path);

        assert_contains(&rendered.html, &expected_base_href(&source_path));
        assert_contains(
            &rendered.html,
            &expected_img("assets/logo.svg", r#"alt="Leaf logo" title="Leaf logo""#),
        );
    }

    #[test]
    fn renders_markdown_links_and_images_for_native_link_handling() {
        let markdown = r#"[External](https://example.com)
[Sibling](./other.md#install)
[Parent](../README.md)
[Escaped](./Nested%20Guide.md#heading)
[Text file](./notes/readme.txt)
[Reference][reference]
<https://example.org/autolink>
<leaf@example.com>

![Relative image](./images/example.svg "Example SVG")

<a href="./raw doc.md#html-heading" title="Raw doc">Raw HTML doc</a>
<img src="./raw image.png" alt="Raw image" title="Raw">

[reference]: ./refs/reference.md#target
"#;
        let source_path = fixture_source_path("project/nested/current.md");

        let rendered = render_markdown_document(markdown, &source_path);

        assert_contains(&rendered.html, &expected_base_href(&source_path));
        for expected in [
            r#"<a href="https://example.com" rel="noopener noreferrer">External</a>"#,
            r##"<a href="./other.md#install" rel="noopener noreferrer">Sibling</a>"##,
            r#"<a href="../README.md" rel="noopener noreferrer">Parent</a>"#,
            r##"<a href="./Nested%20Guide.md#heading" rel="noopener noreferrer">Escaped</a>"##,
            r#"<a href="./notes/readme.txt" rel="noopener noreferrer">Text file</a>"#,
            r##"<a href="./refs/reference.md#target" rel="noopener noreferrer">Reference</a>"##,
            r#"<a href="https://example.org/autolink" rel="noopener noreferrer">https://example.org/autolink</a>"#,
            r#"<a href="mailto:leaf@example.com" rel="noopener noreferrer">leaf@example.com</a>"#,
            r##"<a href="./raw doc.md#html-heading" title="Raw doc" rel="noopener noreferrer">Raw HTML doc</a>"##,
        ] {
            assert_contains(&rendered.html, expected);
        }
        assert_contains(
            &rendered.html,
            &expected_img(
                "images/example.svg",
                r#"alt="Relative image" title="Example SVG""#,
            ),
        );
        assert_contains(
            &rendered.html,
            &expected_img("raw%20image.png", r#"alt="Raw image" title="Raw""#),
        );
        assert!(!rendered.html.contains(r#"<a href="./images/example.svg""#));
    }

    #[test]
    fn renders_heading_ids_and_preserves_markdown_and_html_fragment_links() {
        let markdown = r##"# Main Title

## Section

[Section](#section)
[Relative section](./#section)
[File section](file.md#section)
[Nested escaped section](../guides/Nested%20Guide.md#space-section)
[Space path](./raw%20doc.md#html-heading)
[External](https://example.com/path#outside)

<a href="#section">HTML section</a>
<a href="./#section">HTML relative section</a>
<a href="file.md#section" title="HTML file section">HTML file section</a>
<a href="https://example.com">HTML external</a>

## Section
"##;
        let source_path = fixture_source_path("project/nested/current.md");

        let rendered = render_markdown_document(markdown, &source_path);

        for expected in [
            r#"<h1 id="main-title">Main Title</h1>"#,
            r#"<h2 id="section">Section</h2>"#,
            r#"<h2 id="section-1">Section</h2>"#,
            r##"<a href="#section" rel="noopener noreferrer">Section</a>"##,
            r##"<a href="./#section" rel="noopener noreferrer">Relative section</a>"##,
            r##"<a href="file.md#section" rel="noopener noreferrer">File section</a>"##,
            r##"<a href="../guides/Nested%20Guide.md#space-section" rel="noopener noreferrer">Nested escaped section</a>"##,
            r##"<a href="./raw%20doc.md#html-heading" rel="noopener noreferrer">Space path</a>"##,
            r##"<a href="https://example.com/path#outside" rel="noopener noreferrer">External</a>"##,
            r##"<a href="#section" rel="noopener noreferrer">HTML section</a>"##,
            r##"<a href="./#section" rel="noopener noreferrer">HTML relative section</a>"##,
            r##"<a href="file.md#section" title="HTML file section" rel="noopener noreferrer">HTML file section</a>"##,
            r#"<a href="https://example.com" rel="noopener noreferrer">HTML external</a>"#,
        ] {
            assert_contains(&rendered.html, expected);
        }
    }

    #[test]
    fn preserves_markdown_image_alt_and_title_after_url_resolution() {
        let markdown = r#"![Leaf logo](images/logo.svg "Leaf logo title")"#;
        let source_path = fixture_source_path("project/README.md");

        let rendered = render_markdown_document(markdown, &source_path);

        assert_contains(
            &rendered.html,
            &expected_img(
                "images/logo.svg",
                r#"alt="Leaf logo" title="Leaf logo title""#,
            ),
        );
    }

    #[test]
    fn renders_linked_github_badges_as_images() {
        let markdown = r#"[![Checkup](https://github.com/ryanallen/grid/actions/workflows/checkup.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/checkup.yml)
[![Tests](https://github.com/ryanallen/grid/actions/workflows/tests.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/tests.yml)
[![Lint](https://github.com/ryanallen/grid/actions/workflows/lint.yml/badge.svg?branch=main)](https://github.com/ryanallen/grid/actions/workflows/lint.yml)
[![QEMU Smoke](https://github.com/ryanallen/grid/actions/workflows/qemu-smoke.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/qemu-smoke.yml)
[![Shields Tests](https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests)](https://github.com/ryanallen/grid/actions/workflows/tests.yml)"#;
        let source_path = fixture_source_path("project/README.md");

        let rendered = render_markdown_document(markdown, &source_path);

        for (label, workflow, badge_url) in [
            (
                "Checkup",
                "checkup.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/checkup.yml?label=Checkup",
            ),
            (
                "Tests",
                "tests.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests",
            ),
            (
                "Lint",
                "lint.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/lint.yml?label=Lint",
            ),
            (
                "QEMU Smoke",
                "qemu-smoke.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/qemu-smoke.yml?label=QEMU+Smoke",
            ),
            (
                "Shields Tests",
                "tests.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests",
            ),
        ] {
            assert_contains(
                &rendered.html,
                &format!(
                    r#"<a href="https://github.com/ryanallen/grid/actions/workflows/{workflow}" rel="noopener noreferrer"><img src="{badge_url}" alt="{label}" title="{label}"></a>"#
                ),
            );
        }

        assert!(!rendered
            .html
            .contains(r#"/actions/workflows/checkup.yml/badge.svg"#));
    }

    #[test]
    fn keeps_safe_absolute_markdown_image_urls() {
        let source_path = fixture_source_path("project/README.md");
        let local_image_path = absolute_path_destination_for_fixture("project/assets/logo.svg");
        let local_file_url = file_url_for_fixture("project/assets/logo.svg");
        let markdown = format!(
            r#"![Remote](https://example.com/assets/logo.svg)
![Local]({local_file_url})
![Absolute path]({local_image_path})"#
        );

        let rendered = render_markdown_document(&markdown, &source_path);

        assert_contains(
            &rendered.html,
            r#"<img src="https://example.com/assets/logo.svg" alt="Remote" title="Remote">"#,
        );
        assert_contains(
            &rendered.html,
            &expected_img("assets/logo.svg", r#"alt="Local" title="Local""#),
        );
        assert_contains(
            &rendered.html,
            &expected_img(
                "assets/logo.svg",
                r#"alt="Absolute path" title="Absolute path""#,
            ),
        );
    }

    #[test]
    fn sanitizes_unsafe_markdown_image_urls() {
        let markdown = r#"![Script](javascript:alert(1))
![Data](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)
![Vbscript](vbscript:msgbox(1))"#;
        let source_path = fixture_source_path("project/README.md");

        let rendered = render_markdown_document(markdown, &source_path);

        assert!(!rendered.html.contains("javascript:"));
        assert!(!rendered.html.contains("data:"));
        assert!(!rendered.html.contains("vbscript:"));
        assert_contains(&rendered.html, r#"<img alt="Script" title="Script">"#);
        assert_contains(&rendered.html, r#"<img alt="Data" title="Data">"#);
        assert_contains(&rendered.html, r#"<img alt="Vbscript" title="Vbscript">"#);
    }

    #[test]
    fn resolves_safe_raw_html_image_sources_against_source_directory() {
        let markdown = r#"<p align="center">
<img src="images/logo.png" alt="Leaf logo" title="Leaf" width="96">
<img src=assets/badge.svg alt="Local badge">
</p>"#;
        let source_path = fixture_source_path("project/README.md");

        let rendered = render_markdown_document(markdown, &source_path);

        assert_contains(
            &rendered.html,
            &expected_img("images/logo.png", r#"alt="Leaf logo" title="Leaf""#),
        );
        assert_contains(
            &rendered.html,
            &expected_img("assets/badge.svg", r#"alt="Local badge""#),
        );
    }

    #[test]
    fn preserves_safe_raw_html_image_assets_after_sanitization() {
        let source_path = fixture_source_path("project/README.md");
        let local_file_url = file_url_for_fixture("project/assets/logo.svg");
        let markdown = format!(r#"<img src="{local_file_url}" alt="Leaf logo" title="Logo">"#);

        let rendered = render_markdown_document(&markdown, &source_path);

        assert_contains(
            &rendered.html,
            &expected_img("assets/logo.svg", r#"alt="Leaf logo" title="Logo""#),
        );
    }

    #[test]
    fn local_image_protocol_serves_rendered_markdown_image_bytes() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-local-image-{unique}"));
        let image_dir = dir.join("nested");
        let markdown_path = dir.join("README.md");
        let image_path = image_dir.join("space image.png");
        let png = tiny_png_bytes();

        fs::create_dir_all(&image_dir).expect("test image directory is created");
        fs::write(&image_path, png).expect("test png is written");

        assert_eq!(
            resolve_image_destination("nested/space%20image.png", &markdown_path),
            Some(local_img("nested/space%20image.png"))
        );
        let rendered = render_markdown_document(
            "![Space image](nested/space%20image.png \"Local\")",
            &markdown_path,
        );
        let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
        let response = local_image_protocol_response(
            &local_img("nested/space%20image.png"),
            Some(&source_dir),
        );

        fs::remove_dir_all(&dir).expect("test image directory is removed");

        assert_contains(
            &rendered.html,
            &expected_img(
                "nested/space%20image.png",
                r#"alt="Space image" title="Local""#,
            ),
        );
        assert_eq!(response.status, 200);
        assert_eq!(response.content_type, "image/png");
        assert_eq!(response.body, png);
    }

    #[test]
    fn local_image_protocol_serves_raw_html_svg_bytes() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-local-svg-{unique}"));
        let markdown_path = dir.join("README.md");
        let svg_path = dir.join("logo.svg");
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="green"/></svg>"#;

        fs::create_dir_all(&dir).expect("test svg directory is created");
        fs::write(&svg_path, svg).expect("test svg is written");

        let rendered =
            render_markdown_document(r#"<img src="logo.svg" alt="Logo">"#, &markdown_path);
        let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
        let response = local_image_protocol_response(&local_img("logo.svg"), Some(&source_dir));

        fs::remove_dir_all(&dir).expect("test svg directory is removed");

        assert_contains(&rendered.html, &expected_img("logo.svg", r#"alt="Logo""#));
        assert_eq!(response.status, 200);
        assert_eq!(response.content_type, "image/svg+xml");
        assert_eq!(response.body, svg);
    }

    #[test]
    fn local_image_protocol_serves_requested_markdown_and_html_image_paths() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("leaf-requested-images-{unique}"));
        let docs = root.join("docs");
        let images = docs.join("imgs");
        let shared = root.join("shared");
        let markdown_path = docs.join("current.md");
        let png = tiny_png_bytes();

        fs::create_dir_all(&images).expect("test image directory is created");
        fs::create_dir_all(&shared).expect("test shared directory is created");
        fs::write(images.join("pic.png"), png).expect("test png is written");
        fs::write(images.join("pic one.png"), png).expect("test spaced png is written");
        fs::write(shared.join("pic.png"), png).expect("test parent png is written");

        let markdown = r#"![alt](imgs/pic.png)
![alt](./imgs/pic.png)
![alt](../shared/pic.png)
![alt](imgs/pic%20one.png)
<img src="imgs/pic.png" alt="alt">
<img src="./imgs/pic.png">
![Remote](https://example.com/pic.png)"#;
        let rendered = render_markdown_document(markdown, &markdown_path);
        let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");

        for expected in [
            expected_img("imgs/pic.png", r#"alt="alt" title="alt""#),
            expected_img("__leaf_parent__/shared/pic.png", r#"alt="alt" title="alt""#),
            expected_img("imgs/pic%20one.png", r#"alt="alt" title="alt""#),
        ] {
            assert_contains(&rendered.html, &expected);
        }
        assert_contains(
            &rendered.html,
            &format!(r#"<img src="{}">"#, local_img("imgs/pic.png")),
        );
        assert_contains(
            &rendered.html,
            r#"<img src="https://example.com/pic.png" alt="Remote" title="Remote">"#,
        );

        for path in [
            "imgs/pic.png",
            "imgs/pic%20one.png",
            "__leaf_parent__/shared/pic.png",
        ] {
            let response = local_image_protocol_response(&local_img(path), Some(&source_dir));
            assert_eq!(response.status, 200, "expected {path} to load");
            assert_eq!(response.content_type, "image/png");
            assert_eq!(response.body, png);
        }

        fs::remove_dir_all(&root).expect("test image tree is removed");
    }

    #[test]
    fn local_image_protocol_serves_nested_document_image_paths() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("leaf-nested-images-{unique}"));
        let nested = root.join("docs").join("nested");
        let nested_images = nested.join("imgs");
        let shared = root.join("docs").join("shared");
        let markdown_path = nested.join("current.md");
        let png = tiny_png_bytes();

        fs::create_dir_all(&nested_images).expect("test nested image directory is created");
        fs::create_dir_all(&shared).expect("test shared image directory is created");
        fs::write(nested_images.join("pic.png"), png).expect("nested png is written");
        fs::write(shared.join("pic.png"), png).expect("shared png is written");

        let rendered = render_markdown_document(
            "![Nested](imgs/pic.png)\n![Shared](../shared/pic.png)",
            &markdown_path,
        );
        let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");

        assert_contains(
            &rendered.html,
            &expected_img("imgs/pic.png", r#"alt="Nested" title="Nested""#),
        );
        assert_contains(
            &rendered.html,
            &expected_img(
                "__leaf_parent__/shared/pic.png",
                r#"alt="Shared" title="Shared""#,
            ),
        );

        for path in ["imgs/pic.png", "__leaf_parent__/shared/pic.png"] {
            let response = local_image_protocol_response(&local_img(path), Some(&source_dir));
            assert_eq!(response.status, 200, "expected nested {path} to load");
            assert_eq!(response.body, png);
        }

        fs::remove_dir_all(&root).expect("test nested image tree is removed");
    }

    #[test]
    fn local_image_protocol_blocks_out_of_scope_and_reports_missing_images() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("leaf-local-image-scope-{unique}"));
        let docs = root.join("docs");
        let markdown_path = docs.join("README.md");

        fs::create_dir_all(&docs).expect("test docs directory is created");

        let rendered = render_markdown_document(
            "![Secret](../../secret.png)\n![Missing](missing.png)",
            &markdown_path,
        );
        let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
        let missing = local_image_protocol_response(&local_img("missing.png"), Some(&source_dir));
        let escaped = local_image_protocol_response(
            &local_img("__leaf_parent__/__leaf_parent__/secret.png"),
            Some(&source_dir),
        );

        fs::remove_dir_all(&root).expect("test docs directory is removed");

        assert_contains(
            &rendered.html,
            &expected_img(
                "__leaf_parent__/__leaf_parent__/secret.png",
                r#"alt="Secret" title="Secret""#,
            ),
        );
        assert_contains(
            &rendered.html,
            &expected_img("missing.png", r#"alt="Missing" title="Missing""#),
        );
        assert_eq!(missing.status, 404);
        assert_eq!(escaped.status, 403);
    }

    #[test]
    fn strips_unsafe_raw_html_behavior_and_urls() {
        let markdown = r#"<script>alert('x')</script>
<style>body { color: red; }</style>
<img src="javascript:alert(1)" onerror="alert(2)" alt="bad">
<a href="javascript:alert(3)" onclick="alert(4)">bad link</a>
<p onmouseover="alert(5)">kept <script>alert(6)</script><style>.bad { color: red; }</style> text</p>
<iframe src="https://example.com"></iframe>"#;

        let rendered = render_markdown_document(markdown, "README.md");

        assert!(!rendered.html.contains("<script"));
        assert!(!rendered.html.contains("<style"));
        assert!(!rendered.html.contains("alert('x')"));
        assert!(!rendered.html.contains("alert(6)"));
        assert!(!rendered.html.contains("color: red"));
        assert!(!rendered.html.contains(".bad"));
        assert!(!rendered.html.contains("javascript:"));
        assert!(!rendered.html.contains("onerror"));
        assert!(!rendered.html.contains("onclick"));
        assert!(!rendered.html.contains("onmouseover"));
        assert!(!rendered.html.contains("<iframe"));
        assert_contains(&rendered.html, r#"<img alt="bad">"#);
        assert_contains(
            &rendered.html,
            "<a rel=\"noopener noreferrer\">bad link</a>",
        );
        assert_contains(&rendered.html, "<p>kept  text</p>");
    }

    #[test]
    fn loading_document_preserves_source_markdown() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("leaf-preserve-{unique}.md"));
        let markdown = "# Preserve\n\n- [x] source state\n\n<script>remove()</script>\n";

        fs::write(&path, markdown).expect("test markdown is written");
        let document = load_document(&path).expect("test markdown loads");
        let preserved = fs::read_to_string(&path).expect("test markdown remains readable");
        fs::remove_file(&path).expect("test markdown is removed");

        assert_eq!(document.title, "Preserve");
        assert_contains(&document.html, "source state");
        assert!(!document.html.contains("<script"));
        assert_eq!(preserved, markdown);
    }

    #[test]
    fn opening_document_records_recent_file_and_persists_it() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-open-document-{unique}"));
        let document_path = dir.join("Guide.md");
        let config_path = dir.join("settings").join("recent-files.json");
        fs::create_dir_all(&dir).expect("test directory is created");
        fs::write(&document_path, "# Guide\n\nReadable.").expect("test markdown is written");

        let mut recent = RecentFiles::default();
        let result = open_document_with_recent(&document_path, &mut recent, Some(&config_path))
            .expect("document opens");

        assert_eq!(result.document.title, "Guide");
        assert!(result.recent_save_error.is_none());
        assert_eq!(recent.files, vec![document_path.clone()]);
        assert_eq!(load_recent_files(&config_path).files, vec![document_path]);

        fs::remove_dir_all(&dir).expect("test directory is removed");
    }

    #[test]
    fn opening_missing_document_returns_typed_error_without_changing_recent_files() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("leaf-missing-document-{unique}.md"));
        let mut recent = RecentFiles {
            files: vec![PathBuf::from("already-open.md")],
        };

        let error =
            open_document_with_recent(&path, &mut recent, None).expect_err("missing file fails");

        assert_eq!(error.path(), path.as_path());
        assert_eq!(error.reason().kind(), io::ErrorKind::NotFound);
        assert_eq!(recent.files, vec![PathBuf::from("already-open.md")]);
    }

    #[test]
    fn forget_removes_a_recent_entry_and_reports_whether_it_was_present() {
        let mut recent = RecentFiles {
            files: vec![PathBuf::from("kept.md"), PathBuf::from("gone.md")],
        };

        assert!(recent.forget(Path::new("gone.md")));
        assert_eq!(recent.files, vec![PathBuf::from("kept.md")]);
        // Forgetting something already absent is a no-op and reports false.
        assert!(!recent.forget(Path::new("gone.md")));
        assert_eq!(recent.files, vec![PathBuf::from("kept.md")]);
    }

    #[test]
    fn recent_file_save_error_is_returned_without_blocking_open_document() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-recent-save-error-{unique}"));
        let document_path = dir.join("Release.md");
        fs::create_dir_all(&dir).expect("test directory is created");
        fs::write(&document_path, "# Release\n\nStill opens.").expect("test markdown is written");

        let mut recent = RecentFiles::default();
        let result = open_document_with_recent(&document_path, &mut recent, Some(&dir))
            .expect("document open succeeds when recent save fails");
        let save_error = result
            .recent_save_error
            .expect("recent save error is reported");

        assert_eq!(result.document.title, "Release");
        assert_eq!(recent.files, vec![document_path]);
        assert_eq!(save_error.config_path, dir);

        fs::remove_dir_all(save_error.config_path).expect("test directory is removed");
    }

    #[test]
    fn recent_record_collapses_equivalent_path_spellings() {
        let mut recent = RecentFiles::default();

        // `app/README.md` and `app/.tmp/../README.md` resolve to the same file.
        let clean = Path::new("app").join("README.md");
        let messy = Path::new("app").join(".tmp").join("..").join("README.md");
        recent.record(clean.clone());
        recent.record(messy);

        // Both spellings resolve to the same file, so only one entry remains.
        assert_eq!(recent.files, vec![clean]);
    }

    #[test]
    fn normalize_entries_collapses_existing_duplicate_spellings_on_load() {
        let app_readme = Path::new("app").join("README.md");
        let dharma_readme = Path::new("dharma").join("README.md");
        let mut recent = RecentFiles {
            files: vec![
                Path::new("app").join(".tmp").join("..").join("README.md"),
                dharma_readme.clone(),
                app_readme.clone(),
            ],
        };

        recent.normalize_entries();

        // The two spellings of app/README.md collapse, keeping first-seen order.
        assert_eq!(recent.files, vec![app_readme, dharma_readme]);
    }

    #[test]
    fn recent_files_are_deduplicated_and_limited() {
        let mut recent = RecentFiles::default();

        for index in 0..10 {
            recent.record(PathBuf::from(format!("file-{index}.md")));
        }
        recent.record(PathBuf::from("file-5.md"));

        assert_eq!(recent.files.first(), Some(&PathBuf::from("file-5.md")));
        assert_eq!(recent.files.len(), MAX_RECENT_FILES);
        assert_eq!(
            recent
                .files
                .iter()
                .filter(|path| path.as_os_str() == "file-5.md")
                .count(),
            1
        );
    }

    #[test]
    fn recent_files_persistence_round_trips_and_falls_back_safely() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-recent-persistence-{unique}"));
        let config_path = dir.join("settings").join("recent-files.json");
        let missing_path = dir.join("missing.json");

        let mut recent = RecentFiles::default();
        recent.record(PathBuf::from("first.md"));
        recent.record(PathBuf::from("second.md"));

        save_recent_files(&config_path, &recent).expect("recent files save");
        assert_eq!(load_recent_files(&config_path), recent);
        assert_eq!(load_recent_files(&missing_path), RecentFiles::default());

        fs::write(&config_path, "{not json").expect("corrupt recent files fixture is written");
        assert_eq!(load_recent_files(&config_path), RecentFiles::default());

        fs::remove_dir_all(&dir).expect("test directory is removed");
    }

    #[test]
    fn settings_default_keeps_minimap_on_and_indexing_off() {
        let settings = Settings::default();
        assert!(settings.minimap_enabled);
        assert!(!settings.indexing_enabled);
        assert!(!settings.speed_reader_enabled);
        assert_eq!(settings.theme_mode, "system");
        assert_eq!(settings.library_view, LibraryView::Project);
        assert!(settings.library_expanded.is_empty());
        assert!(settings.library_project_path.is_empty());
        // The pane is open by default, with the 240px fallback width.
        assert!(!settings.library_closed);
        assert_eq!(settings.library_width, 240);
    }

    #[test]
    fn settings_persistence_round_trips_and_falls_back_safely() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-settings-persistence-{unique}"));
        let settings_path = dir.join("config").join("settings.json");
        let missing_path = dir.join("missing.json");

        let settings = Settings {
            indexing_enabled: true,
            minimap_enabled: false,
            pager_enabled: false,
            speed_reader_enabled: true,
            theme_mode: "dracula".to_string(),
            library_view: LibraryView::Tree,
            library_expanded: vec!["C:\\Users".to_string(), "C:\\Users\\rwall".to_string()],
            library_project_path: "C:\\Users\\rwall".to_string(),
            library_closed: true,
            library_width: 312,
        };

        save_settings(&settings_path, &settings).expect("settings save");
        assert_eq!(load_settings(&settings_path), settings);
        // A missing file restores defaults, not the all-false zero value.
        assert_eq!(load_settings(&missing_path), Settings::default());

        fs::write(&settings_path, "{not json").expect("corrupt settings fixture is written");
        assert_eq!(load_settings(&settings_path), Settings::default());

        fs::remove_dir_all(&dir).expect("test directory is removed");
    }

    #[test]
    fn settings_load_tolerates_partial_json_via_serde_default() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-settings-partial-{unique}"));
        let settings_path = dir.join("settings.json");
        fs::create_dir_all(&dir).expect("test directory is created");

        // Only one field present: the rest must fall back to their defaults.
        fs::write(&settings_path, r#"{"indexing_enabled": true}"#)
            .expect("partial settings fixture is written");
        let loaded = load_settings(&settings_path);
        assert!(loaded.indexing_enabled);
        assert!(loaded.minimap_enabled);
        assert_eq!(loaded.theme_mode, "system");
        assert_eq!(loaded.library_view, LibraryView::Project);
        assert!(loaded.library_expanded.is_empty());
        assert!(!loaded.library_closed);
        assert_eq!(loaded.library_width, 240);

        fs::remove_dir_all(&dir).expect("test directory is removed");
    }

    #[test]
    fn app_shell_wires_library_pane_open_close_and_resize() {
        let html = app_shell_html();

        // Markup: the resize divider on the pane edge and the open button that
        // stays reachable (positioned against the shell) when the column is 0.
        assert!(html.contains(r#"<div id="libraryDivider" class="library-divider" data-i18n-title="library.divider.resize" title="Resize library""#));
        assert!(html.contains(r#"<button type="button" id="libraryOpen" class="library-open" data-i18n-title="library.open" data-i18n-aria-label="library.open""#));

        // The open icon is the bundled asset, normalized to currentColor like the
        // other toolbar icons (no stray literal stroke color survives).
        let open_icon = normalize_svg_icon_colors(OPEN_LIBRARY_ICON_SVG);
        assert!(open_icon.contains("stroke=\"currentColor\""));
        assert!(html.contains(open_icon.trim()));

        // CSS: the collapsed-grid override, the divider hit target, and the open
        // button pinned to the shell's left edge.
        assert!(html.contains(
            ".library-shell.library-closed {\n  grid-template-columns: 0 minmax(0, 1fr);\n}"
        ));
        assert!(html.contains(".library-divider {"));
        assert!(html.contains("cursor: col-resize;"));
        assert!(html.contains(".library-shell.library-closed .library-open {"));

        // Behavior constants and the host-persisted layout report.
        assert!(html.contains("const SNAP_SHUT = 40;"));
        assert!(html.contains("const DEFAULT_PANE_WIDTH = 240;"));
        assert!(html.contains("const MIN_READER_WIDTH = 360;"));
        assert!(html.contains("send({ command: 'setLibraryLayout', closed: libraryUserClosed, width: Math.round(libraryWidth) });"));

        // State seeded from the host-injected settings, not localStorage.
        assert!(html.contains("let libraryUserClosed = LEAF_SETTINGS.libraryClosed === true;"));
        assert!(html.contains("LEAF_SETTINGS.libraryWidth"));

        // Snap-shut closes mid-drag; the divider drag is rAF-throttled.
        assert!(html.contains("if (raw < SNAP_SHUT) {"));
        assert!(
            html.contains("dividerDrag.frame = requestAnimationFrame(applyPendingDividerWidth);")
        );

        // Open button restores the pane; layout applies on boot and on resize.
        assert!(html.contains("libraryOpen.addEventListener('click', openLibrary);"));
        assert!(html.contains("applyPaneLayout();\nsend({ command: 'getFileTree' });"));
        assert!(html.contains("window.addEventListener('resize', () => {"));
    }

    #[test]
    fn initial_settings_script_defines_camelcase_global() {
        let script = initial_settings_script(&Settings {
            indexing_enabled: true,
            minimap_enabled: false,
            pager_enabled: false,
            speed_reader_enabled: true,
            theme_mode: "dracula".to_string(),
            library_view: LibraryView::Tree,
            library_expanded: vec!["C:\\Users".to_string()],
            library_project_path: "docs".to_string(),
            library_closed: true,
            library_width: 312,
        });
        assert_eq!(
            script,
            r#"window.__leafSettings = {"indexingEnabled":true,"libraryClosed":true,"libraryExpanded":["C:\\Users"],"libraryProjectPath":"docs","libraryView":"tree","libraryWidth":312,"minimapEnabled":false,"pagerEnabled":false,"speedReaderEnabled":true,"themeMode":"dracula"};"#
        );
    }

    #[test]
    fn settings_file_path_lives_in_leaftext_config() {
        let path = settings_file_path().expect("project config directory is available");
        assert!(path.ends_with("settings.json"));
        assert!(path.to_string_lossy().contains("leaftext"));
    }

    #[test]
    fn webview_user_data_dir_uses_leaftext_local_data() {
        let path = webview_user_data_dir().expect("project data directory is available");
        let path_display = path.to_string_lossy();

        assert!(path.ends_with("webview2"));
        assert!(path_display.contains("leaftext"));
    }

    #[test]
    fn app_data_dir_is_the_local_data_root_not_the_webview_cache() {
        let path = app_data_dir().expect("project data directory is available");
        let path_display = path.to_string_lossy();
        assert!(path_display.contains("leaftext"));
        // The manifest must not live under the WebView2-specific subfolder.
        assert!(!path.ends_with("webview2"));
    }

    #[test]
    fn app_shell_includes_library_pane_settings_and_i18n() {
        let html = app_shell_html();

        // Layout: the two-column shell driven by the CSS variable.
        assert!(html.contains(r#"<div id="libraryShell" class="library-shell">"#));
        assert!(html.contains("grid-template-columns: var(--library-width, 240px) minmax(0, 1fr);"));
        assert!(html.contains(r#"<aside id="libraryPane" class="library-pane">"#));
        assert!(html.contains(r#"<div id="libraryTree" class="library-tree"></div>"#));
        assert!(html.contains(r#"id="libraryScanProgress""#));

        // Settings toggle + host-persisted change reporting.
        assert!(html.contains(r#"<input type="checkbox" id="indexingEnabled""#));
        assert!(html.contains("send({ command: 'setIndexingEnabled', enabled: indexingEnabled });"));
        assert!(html.contains("command: 'setLibraryState',"));
        // The three view modes and the cycling toggle.
        assert!(html.contains("const LIBRARY_VIEWS = ['project', 'tree', 'flat'];"));
        // Markdown rows carry the leaf mark; folders in Project view get a chevron.
        assert!(html.contains(r#"<img class="library-file-icon" src="${LEAF_FILE_ICON}""#));
        assert!(html.contains(r#"<span class="library-nav-chevron" aria-hidden="true">›</span>"#));

        // Library callbacks, the host-injected settings global it seeds from, and
        // the boot-time render + tree load.
        assert!(html.contains("window.leafSetLibraryState ="));
        assert!(html.contains("window.leafSetScanProgress ="));
        assert!(html.contains("window.leafSetSearchResults ="));
        assert!(html.contains("const LEAF_SETTINGS = (window.__leafSettings"));
        assert!(html.contains("send({ command: 'getFileTree' });"));

        // The search field, its debounced request, and the result-open + jump.
        assert!(html.contains(r#"<input id="librarySearch" class="library-search""#));
        assert!(html.contains(r#"data-i18n-placeholder="library.search.placeholder""#));
        assert!(html.contains("send({ command: 'search', query });"));
        assert!(html.contains("window.leafScrollToFragment('#' + jump.anchor);"));

        // File-derived strings are escaped before reaching the DOM (tree + hits).
        assert!(html.contains(r#"data-open-path="${escapeAttr(node.path)}""#));
        assert!(html.contains(r#"data-open-path="${escapeAttr(path)}""#));

        // i18n keys exist in both dictionaries.
        for key in [
            "settings.indexing.label",
            "settings.indexing.help",
            "library.title",
            "library.view.toggle",
            "library.view.project",
            "library.view.tree",
            "library.view.all",
            "library.up",
            "library.scanning",
            "library.filesFound",
            "library.empty",
            "library.open",
            "library.divider.resize",
            "library.search.placeholder",
            "library.search.noResults",
            "library.search.count",
            "library.search.loading",
            "library.search.error",
        ] {
            let needle = format!("'{key}':");
            let count = html.matches(&needle).count();
            assert!(
                count >= 2,
                "expected EN + ZH-CN entries for {key}, found {count}"
            );
        }
    }

    #[test]
    fn library_follows_and_highlights_the_active_file() {
        let html = app_shell_html();

        // The active tab's path is what the library highlights as current.
        assert!(html.contains("function activeDocumentPath()"));
        // The selected row carries the marker class the CSS keys off of.
        assert!(html.contains(r#"class="library-file${selected}""#));
        assert!(html.contains(".library-file.is-selected,"));

        // Reveal helpers: locate the file in the tree, drill/expand to it.
        assert!(html.contains("function folderAncestorsOf(nodes, filePath)"));
        assert!(html.contains("function revealSelectedInLibrary()"));
        assert!(html.contains("function scrollSelectedLibraryRowIntoView()"));

        // Going to a file (open, switch, click a tab) follows it; the tree
        // arriving later runs a queued reveal.
        assert!(html.contains("followFileInLibrary(activeDocumentPath());"));
        assert!(html.contains("followFileInLibrary(tab ? tab.path || null : null);"));
        assert!(html.contains("if (libraryRevealPending && revealSelectedInLibrary()) return;"));
    }

    #[test]
    fn library_row_context_menu_offers_file_actions() {
        let html = app_shell_html();

        // The right-click menu is built from a list of file actions, ordered with
        // the destructive delete flagged and set apart.
        assert!(html.contains("const CONTEXT_MENU_ITEMS = ["));
        for action in [
            "'open'",
            "'cut'",
            "'copy'",
            "'copyPath'",
            "'rename'",
            "'reveal'",
            "'properties'",
            "'delete'",
        ] {
            assert!(html.contains(action), "menu missing action {action}");
        }
        assert!(html.contains("danger: true"));

        // Each action maps to the backend command that carries it out.
        assert!(html.contains("send({ command: 'copyFile', path, cut: true })"));
        assert!(html.contains("send({ command: 'copyFile', path, cut: false })"));
        assert!(html.contains("send({ command: 'copyPath', path })"));
        assert!(html.contains("send({ command: 'showProperties', path })"));
        assert!(html.contains("send({ command: 'deleteFile', path })"));
        assert!(html.contains("send({ command: 'renameFile', path, newName })"));

        // The inline rename box and the new menu labels are present.
        assert!(html.contains("function openRenameBox(path)"));
        assert!(html.contains("'actions.delete': 'Delete'"));
        assert!(html.contains("'actions.delete': '删除'"));
    }

    #[test]
    fn code_blocks_get_a_copy_button() {
        let html = app_shell_html();

        // Decoration runs after each document render, over code blocks but not
        // Mermaid diagrams, and copies the <code> text.
        assert!(html.contains("decorateCodeBlocks();"));
        assert!(html.contains(".document-body pre:not(.mermaid)"));
        assert!(html.contains("function copyCodeBlock(button, text)"));
        // Clipboard API with an execCommand fallback for locked-down webviews.
        assert!(html.contains("navigator.clipboard.writeText(text)"));
        assert!(html.contains("document.execCommand('copy')"));
        // The button styling and copied-state swap exist.
        assert!(html.contains(".document-body pre > .code-copy {"));
        assert!(html.contains(".code-copy.is-copied .code-copy-check {"));

        // Labels exist in both dictionaries.
        for key in ["actions.copyCode", "actions.copiedCode"] {
            let needle = format!("'{key}':");
            let count = html.matches(&needle).count();
            assert!(
                count >= 2,
                "expected EN + ZH-CN entries for {key}, found {count}"
            );
        }
    }

    #[test]
    fn anchor_addressable_blocks_get_a_permalink_button() {
        let html = app_shell_html();

        // Decoration runs after each document render, before link binding so the
        // injected anchors get wired into in-document fragment navigation.
        assert!(html.contains("function decorateAnchorLinks()"));
        let render = html
            .find("decorateAnchorLinks();")
            .expect("decorateAnchorLinks is called during render");
        let bind = html[render..]
            .find("bindDocumentLinks();")
            .map(|index| render + index)
            .expect("bindDocumentLinks is called during render");
        assert!(
            render < bind,
            "anchors must be injected before links are bound"
        );

        // Standard content blocks get ids assigned if they do not already have
        // one, then become permalink targets. Footnote definitions (which carry
        // their own back-reference) are excluded.
        assert!(html.contains("const ANCHOR_LINK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre:not(.mermaid), table, details, figure, div[id], a[id]'"));
        assert!(html.contains("function ensureAnchorLinkTargets(body)"));
        assert!(html.contains("target.id = uniqueAnchorBlockId(seen, locus);"));
        assert!(html.contains("target.classList.contains('footnote-definition')"));

        // Body blocks are numbered chapter.verse with a dot: an h1 opens a
        // chapter, and every following body block is the next running verse (1.1,
        // 1.2, …); the verse counter runs through sub-headings and resets at the
        // next chapter. Headings (h1–h6) are numbered h<chapter>.<n> so the
        // leading "h" tells them apart from body blocks, and the navigation
        // outline (link-only list items) is skipped.
        assert!(html.contains("let chapter = 0;"));
        assert!(html.contains("if (tag === 'H1') {"));
        assert!(html.contains("assignLocus(target, 'h' + chapter + '.' + headingNum, seen);"));
        assert!(html.contains("assignLocus(target, chapter + '.' + verse, seen);"));
        assert!(html.contains("function isNavOutlineItem(el)"));

        // The button is a real anchor link to the block's locus (dataset.locus).
        // A block that already has an id (an h1 chapter, an author anchor) keeps
        // it, and a hidden alias anchor resolves #<locus>, so the link can target
        // the verse without disturbing the element's own id.
        assert!(html.contains("link.href = '#' + encodeURIComponent(locus)"));

        // The gutter button shows the chain glyph (revealed on hover); a hidden
        // alias carries the locus for blocks that already have an id.
        assert!(html.contains("link.innerHTML = ANCHOR_LINK_ICON;"));
        assert!(html.contains("alias.className = 'locus-alias';"));

        // Clicking the gutter button copies its #locus so the canonical number can
        // be pasted out — the way to read the locus on touch, where there is no
        // hover tooltip. The jump still happens (the copy listener does not
        // preventDefault), and a brief is-copied flash confirms the copy.
        assert!(html.contains("function copyToClipboard(text)"));
        assert!(html.contains("copyToClipboard('#' + locus);"));
        assert!(html.contains(".document-body .heading-anchor.is-copied {"));

        // Gutter button styling exists and stays out of the horizontal scroll.
        assert!(html.contains(".document-body .heading-anchor {"));
        assert!(html.contains("overflow-x: clip;"));
        assert!(html.contains("background: var(--app-action-hover-background);"));
        assert!(html.contains(".document-body .has-anchor-link > .heading-anchor:hover,"));

        // Each button is shifted left by its block's measured indentation so a
        // nested block's button lands in the same left gutter as a top-level
        // heading's instead of overlapping its indented text. decorateAnchorLinks
        // positions them once, and scheduleReaderLayoutUpdate repositions them on
        // every reflow and resize since the indent is em-based.
        assert!(html.contains("function positionAnchorLinks(body)"));
        assert!(html.contains("block.getBoundingClientRect().left - bodyLeft"));
        assert!(html.contains(
            "link.style.right = indent > 0.5 ? `calc(100% + ${Math.round(indent)}px)` : '';"
        ));
        let decorate_body = html
            .find("positionAnchorLinks(body);")
            .expect("decorateAnchorLinks positions the buttons it injects");
        let reflow = html
            .find("readerLayoutFrame = 0;")
            .expect("scheduleReaderLayoutUpdate exists");
        let reflow_reposition = html[reflow..]
            .find("positionAnchorLinks();")
            .map(|offset| reflow + offset)
            .expect("the reflow frame repositions the buttons");
        assert!(
            decorate_body < reflow_reposition,
            "buttons are positioned at decorate time and again on reflow"
        );

        // Only the innermost hovered/focused block reveals its button. Without the
        // :not(:has(...)) guard, hovering a nested block would also light up every
        // ancestor block's button, stacking ghost buttons in the shared gutter.
        assert!(html.contains(
            ".document-body .has-anchor-link:hover:not(:has(.has-anchor-link:hover)) > .heading-anchor,"
        ));
        assert!(html.contains(
            ".document-body .has-anchor-link:focus-within:not(:has(.has-anchor-link:focus-within)) > .heading-anchor,"
        ));

        // A narrow window (and touch, which has no real hover) can't host the wide
        // gutter the permalink centers in, so it would land off-screen. Pin the
        // glyph to the gutter edge with flex-end, shrink it, and keep it faintly
        // visible at all times — holding that opacity through a block's sticky hover
        // so a tap on body text doesn't flash it and eat the tap.
        assert!(html.contains("@media (hover: none), (max-width: 600px) {"));
        let narrow = html
            .find("@media (hover: none), (max-width: 600px) {")
            .expect("small-screen permalink media query exists");
        assert!(html[narrow..].contains("justify-content: flex-end;"));

        // Label exists in both dictionaries.
        let count = html.matches("'actions.anchorLink':").count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for actions.anchorLink, found {count}"
        );
    }
}
