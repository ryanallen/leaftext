//! Core document rendering and app-state helpers for leaftext.

pub mod indexer;
mod markdown;
mod theme;
pub(crate) use markdown::*;
pub use markdown::{local_image_protocol_response, local_image_source_dir};
pub(crate) use theme::*;

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
const APP_SHELL_HTML: &str = include_str!("assets/app-shell.html");
const APP_SHELL_SCRIPT: &str = include_str!("assets/app-shell.js");
const BACK_ICON_SVG: &str = include_str!("assets/arrow-left.svg");
const FORWARD_ICON_SVG: &str = include_str!("assets/arrow-right.svg");
const SETTINGS_ICON_SVG: &str = include_str!("assets/adjustments-vertical.svg");
const OPEN_LIBRARY_ICON_SVG: &str = include_str!("assets/library.svg");
const OPEN_ICON_SVG: &str = include_str!("assets/folder-open.svg");
const BRAND_LOGO_DATA_URI: &str = include_str!("assets/brand-logo.txt");
const FOOTNOTE_BACKREF_ICON_SVG: &str = include_str!("assets/arrow-uturn-left.svg");
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
    if path.extension().and_then(|e| e.to_str()) == Some("xml") {
        return load_xml_document(path);
    }
    let markdown = fs::read_to_string(path)?;
    Ok(opened_document_from_markdown(&markdown, path))
}

/// Load a TEI XML document from disk and render it to an `OpenedDocument`.
pub fn load_xml_document(path: impl AsRef<Path>) -> io::Result<OpenedDocument> {
    let path = path.as_ref();
    let xml = fs::read_to_string(path)?;
    Ok(opened_document_from_tei(&xml, path))
}

/// Render a TEI XML string into an `OpenedDocument`.
pub fn opened_document_from_tei(xml: &str, path: impl AsRef<Path>) -> OpenedDocument {
    let path = path.as_ref();
    let render_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    let (title, body_html) = render_tei_body(xml);

    let title = title
        .or_else(|| {
            render_path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(plain_document_title)
        })
        .unwrap_or_else(|| "Untitled document".to_string());

    let base_href = render_path
        .parent()
        .and_then(|parent| Url::from_directory_path(parent).ok())
        .map(|url| format!(r#"<base href="{}">"#, encode_text(url.as_str())))
        .unwrap_or_default();

    // Optionally auto-link glossary terms from GLOSSARY.md next to the doc.
    let body_html = match render_path.parent() {
        Some(dir) => auto_link_glossary(body_html, dir),
        None => body_html,
    };

    // The minimap canvas paints from the span model, so chart the rendered block
    // HTML (there is no Markdown source to line-scan for TEI). Do this before the
    // body is wrapped in the <article>/pager shell so the scan sees only content.
    let minimap = build_minimap_model_from_html(&body_html);

    let article = format!(
        r#"{base_href}<article class="document-body">{body_html}{}</article>"#,
        pager_loading_html()
    );

    OpenedDocument {
        title,
        path: path.display().to_string(),
        html: article,
        minimap,
    }
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
        } else if path.file_name().and_then(|n| n.to_str()).is_some() {
            // Markdown and TEI XML documents are both sequential pages. README
            // (the folder's landing page, added by the parent) and GLOSSARY (the
            // sheet, never a page) are excluded by stem so either extension drops.
            let is_doc = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("xml"));
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            let is_index =
                stem.eq_ignore_ascii_case("README") || stem.eq_ignore_ascii_case("GLOSSARY");
            if is_doc && !is_index {
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
    // Drop a trailing `.md` or `.xml` (case-insensitively); leave any other name
    // — including folders, which carry no such extension — untouched.
    let base = raw
        .rsplit_once('.')
        .filter(|(_, ext)| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("xml"))
        .map(|(stem, _)| stem)
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
    // Auto-link glossary terms from the nearest GLOSSARY.md, so terms link even
    // when the source markdown didn't spell out the links. Occurrences already
    // inside a manual link (or code) are left untouched by the linker. Skip the
    // glossary file itself, so its own entries don't get self-linked.
    let is_glossary = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("GLOSSARY.md"))
        .unwrap_or(false);
    let body = match (is_glossary, source_path.parent()) {
        (false, Some(dir)) => auto_link_glossary(body, dir),
        _ => body,
    };
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

// ---------------------------------------------------------------------------
// TEI XML renderer
// ---------------------------------------------------------------------------

/// Heading level for a div, from its nesting depth.
///
/// `type="translation"` is a transparent wrapper — it holds the whole translated
/// work but is not itself a titled section, so it emits no heading and leaves the
/// depth of the sections inside it unchanged.
///
/// Every other div is a nested section whose heading level follows nesting depth
/// alone (h2 at the top, one smaller per level, floored at h6). 84000 TEI nests
/// these types in varying orders — a `section` may contain a `chapter` and a
/// `chapter` may contain a `section` — so a fixed type→level table produces
/// inversions where a nested heading renders *larger* than the heading above it.
/// Depth-based levels keep a child heading always at or below its parent's size.
fn tei_div_heading_level(div_type: &str, depth: usize) -> Option<u8> {
    if div_type.eq_ignore_ascii_case("translation") {
        return None;
    }
    Some((2 + depth as u8).min(6))
}

/// GitHub-compatible slug from plain text (matches slugger.js behaviour).
fn tei_slugify(text: &str) -> String {
    let lower = text.to_lowercase();
    let cleaned: String = lower
        .chars()
        .filter(|c| c.is_alphabetic() || c.is_numeric() || *c == '-' || *c == '_' || *c == ' ')
        .collect();
    cleaned.replace(' ', "-")
}

struct TeiCtx {
    out: String,
    footnotes: Vec<String>,
    fn_count: usize,
    seen: HashMap<String, usize>,
}

impl TeiCtx {
    fn new() -> Self {
        Self {
            out: String::new(),
            footnotes: Vec::new(),
            fn_count: 0,
            seen: HashMap::new(),
        }
    }

    fn unique_slug(&mut self, text: &str) -> String {
        let base = tei_slugify(text);
        let count = self.seen.entry(base.clone()).or_insert(0);
        let slug = if *count == 0 {
            base.clone()
        } else {
            format!("{base}-{count}")
        };
        *count += 1;
        slug
    }

    fn push(&mut self, s: &str) {
        self.out.push_str(s);
    }
}

/// Render the inline content of a node (text + inline children).
fn tei_render_inline<'a>(node: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx) -> String {
    let mut out = String::new();
    for child in node.children() {
        if child.is_text() {
            out.push_str(&encode_text(child.text().unwrap_or("")));
        } else if child.is_element() {
            let tag = child.tag_name().name().to_lowercase();
            match tag.as_str() {
                "note" if child.attribute("place") == Some("end") => {
                    ctx.fn_count += 1;
                    let n = ctx.fn_count;
                    let fn_html = tei_render_inline(child, ctx);
                    ctx.footnotes.push(fn_html);
                    // Avoid `ref{n}` in format strings (Rust 2021 lexer issue).
                    // Match the markdown renderer's footnote reference markup so
                    // CSS and numbering are identical (plain Arabic, no brackets).
                    let refid = format!("fnref{n}");
                    out.push_str(&format!(
                        "<sup class=\"footnote-reference\" id=\"{refid}\">\
                         <a href=\"#fn{n}\">{n}</a></sup>"
                    ));
                }
                "ptr" => {
                    // 84000 TEI puts the visible cross-reference label INSIDE
                    // <ptr> (e.g. <ptr target="...">Going forth</ptr>). Keep the
                    // label text; link it only when the target is an external URL
                    // (internal #ids don't map to our heading slugs).
                    let label = tei_render_inline(child, ctx);
                    if !label.is_empty() {
                        match child.attribute("target") {
                            Some(t) if t.starts_with("http://") || t.starts_with("https://") => {
                                out.push_str(&format!(
                                    "<a href=\"{}\">{label}</a>",
                                    encode_double_quoted_attribute(t)
                                ));
                            }
                            _ => out.push_str(&label),
                        }
                    }
                }
                "milestone" | "lb" | "caesura" => {
                    // omit
                }
                _ => {
                    // term, title, ref, foreign, hi, quote, etc. → strip tag, keep text
                    out.push_str(&tei_render_inline(child, ctx));
                }
            }
        }
    }
    out
}

/// Wrap verse lines in a blockquote so they render like a Markdown `>` quote
/// (left bar + hanging indent), with each `<l>` line on its own row.
fn tei_verse_blockquote(lines: &[String]) -> String {
    format!(
        "<blockquote class=\"tei-verse\">\n<p>{}</p>\n</blockquote>\n",
        lines.join("<br>\n")
    )
}

/// Render a run of block-level sibling elements, coalescing consecutive `<l>`
/// lines (verse lines not wrapped in an `<lg>`) into a single quote block so
/// they still render like a Markdown `>` quote when the `<lg>` group is absent.
fn tei_render_block_sequence<'a>(
    siblings: &[roxmltree::Node<'a, 'a>],
    ctx: &mut TeiCtx,
    depth: usize,
) {
    let is_line = |n: &roxmltree::Node| n.tag_name().name().eq_ignore_ascii_case("l");
    let mut i = 0;
    while i < siblings.len() {
        if is_line(&siblings[i]) {
            let mut lines = Vec::new();
            while i < siblings.len() && is_line(&siblings[i]) {
                lines.push(tei_render_inline(siblings[i], ctx));
                i += 1;
            }
            ctx.push(&tei_verse_blockquote(&lines));
        } else {
            tei_render_node(siblings[i], ctx, depth);
            i += 1;
        }
    }
}

/// Render a TEI `<div>` element.
fn tei_render_div<'a>(node: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx, depth: usize) {
    let div_type = node.attribute("type").unwrap_or("");

    let heading_level = tei_div_heading_level(div_type, depth);

    if heading_level.is_none() {
        // transparent container (e.g. div[@type="translation"])
        let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
        tei_render_block_sequence(&children, ctx, depth);
        return;
    }
    let level = heading_level.unwrap();

    // Find and emit the <head> child first
    let head_node = node
        .children()
        .find(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("head"));
    if let Some(head) = head_node {
        // Collect ALL descendant text so inline children render too. Heads like
        // `<head>Prologue to <title>The Chapter on Going Forth</title></head>`
        // would otherwise keep only the leading "Prologue to " text node.
        let text = head
            .descendants()
            .filter(|c| c.is_text())
            .map(|c| c.text().unwrap_or(""))
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !text.is_empty() {
            let id = ctx.unique_slug(&text);
            ctx.push(&format!(
                "<h{level} id=\"{}\">{}</h{level}>\n",
                encode_double_quoted_attribute(&id),
                encode_text(&text)
            ));
        }
    }

    // Render non-head children
    let children: Vec<_> = node
        .children()
        .filter(|c| c.is_element() && !c.tag_name().name().eq_ignore_ascii_case("head"))
        .collect();
    tei_render_block_sequence(&children, ctx, depth + 1);
}

/// Dispatch rendering for any TEI element node.
fn tei_render_node<'a>(node: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx, depth: usize) {
    if !node.is_element() {
        return;
    }
    let tag = node.tag_name().name().to_lowercase();
    match tag.as_str() {
        "div" => tei_render_div(node, ctx, depth),
        "p" => {
            let inner = tei_render_inline(node, ctx);
            ctx.push(&format!("<p>{inner}</p>\n"));
        }
        "lg" => {
            let lines: Vec<String> = node
                .children()
                .filter(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("l"))
                .map(|l| tei_render_inline(l, ctx))
                .collect();
            ctx.push(&tei_verse_blockquote(&lines));
        }
        "head" | "milestone" | "lb" | "ptr" | "caesura" => {
            // omit at top level; head is handled by renderDiv
        }
        _ => {
            // Recurse into unknown block elements, still coalescing bare `<l>`.
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            tei_render_block_sequence(&children, ctx, depth);
        }
    }
}

/// Render `text > front` as a collapsed `<details>` so the summary,
/// acknowledgements, and introduction are available but out of the way by
/// default — the reader lands on the translation itself. The inner content uses
/// the same block machinery as the body, so its headings and anchors work
/// unchanged. Mirrors `renderFront` in site/tei-xml.js.
fn render_tei_front<'a>(front: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx) {
    // Render the front's children into `ctx.out`, then split that tail back off
    // so it can be wrapped. Slug and footnote side effects stay recorded on ctx.
    let start = ctx.out.len();
    let children: Vec<_> = front.children().filter(|c| c.is_element()).collect();
    tei_render_block_sequence(&children, ctx, 0);
    let inner = ctx.out.split_off(start);
    if inner.trim().is_empty() {
        return;
    }

    // Label the toggle with the section names it holds (e.g. "Summary,
    // Acknowledgements, Introduction"), falling back to a generic term.
    let heads: Vec<String> = front
        .children()
        .filter(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("div"))
        .filter_map(|d| {
            d.children()
                .find(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("head"))
        })
        .map(|head| {
            head.descendants()
                .filter(|c| c.is_text())
                .map(|c| c.text().unwrap_or(""))
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|t| !t.is_empty())
        .collect();
    let label = if heads.is_empty() {
        "Front matter".to_string()
    } else {
        heads.join(", ")
    };

    ctx.push(&format!(
        "<details class=\"tei-front\">\n\
         <summary class=\"tei-front-summary\">{}</summary>\n\
         <div class=\"tei-front-body\">\n",
        encode_text(&label)
    ));
    ctx.push(&inner);
    ctx.push("</div>\n</details>\n");
}

/// Parse TEI XML and return `(title, body_html)`.
/// Title is extracted from the `<teiHeader>` if possible.
fn render_tei_body(xml: &str) -> (Option<String>, String) {
    let doc = match roxmltree::Document::parse(xml) {
        Ok(d) => d,
        Err(_) => return (None, "<p><strong>XML parse error.</strong></p>".to_string()),
    };

    let root = doc.root_element();

    // Extract title from teiHeader
    let title = root
        .descendants()
        .find(|n| {
            n.is_element()
                && n.tag_name().name().eq_ignore_ascii_case("title")
                && n.parent()
                    .map(|p| p.tag_name().name().eq_ignore_ascii_case("titleStmt"))
                    .unwrap_or(false)
        })
        .and_then(|n| {
            let t = n
                .children()
                .filter(|c| c.is_text())
                .map(|c| c.text().unwrap_or(""))
                .collect::<String>();
            let t = t.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        });

    // Find <text><body>
    let body = root.descendants().find(|n| {
        n.is_element()
            && n.tag_name().name().eq_ignore_ascii_case("body")
            && n.parent()
                .map(|p| p.tag_name().name().eq_ignore_ascii_case("text"))
                .unwrap_or(false)
    });

    let Some(body) = body else {
        return (
            title,
            "<p><strong>No TEI body element found.</strong></p>".to_string(),
        );
    };

    let mut ctx = TeiCtx::new();

    // Title heading
    if let Some(ref t) = title {
        let id = ctx.unique_slug(t);
        ctx.push(&format!(
            "<h1 id=\"{}\">{}</h1>\n",
            encode_double_quoted_attribute(&id),
            encode_text(t)
        ));
    }

    // Front matter (summary, acknowledgements, introduction) lives in
    // `text > front`, a sibling of `body`. Render it collapsed by default, after
    // the title and before the body.
    if let Some(front) = root.descendants().find(|n| {
        n.is_element()
            && n.tag_name().name().eq_ignore_ascii_case("front")
            && n.parent()
                .map(|p| p.tag_name().name().eq_ignore_ascii_case("text"))
                .unwrap_or(false)
    }) {
        render_tei_front(front, &mut ctx);
    }

    let body_children: Vec<_> = body.children().filter(|c| c.is_element()).collect();
    tei_render_block_sequence(&body_children, &mut ctx, 0);

    // Append footnotes — build as a separate string to avoid borrow conflicts
    // while iterating `ctx.footnotes` and mutating `ctx.out`.
    if !ctx.footnotes.is_empty() {
        // Match the markdown renderer's footnote markup: `<div
        // class="footnote-definition">` blocks (not an `<ol>`, which would inherit
        // the upper-roman list style) with the shared SVG back-reference icon.
        let icon = footnote_backref_icon_svg();
        let mut fn_section = String::from("<section class=\"footnotes\">\n");
        for (i, fn_html) in ctx.footnotes.iter().enumerate() {
            let n = i + 1;
            // Avoid `ref{n}` in format strings (Rust 2021 lexer issue).
            let backref = format!("#fnref{n}");
            fn_section.push_str(&format!(
                "<div class=\"footnote-definition\" id=\"fn{n}\">\
                 <sup class=\"footnote-definition-label\">{n}</sup>\
                 <p>{fn_html} <a class=\"footnote-backref\" href=\"{backref}\" \
                 aria-label=\"Back to content\">{icon}</a></p></div>\n"
            ));
        }
        fn_section.push_str("</section>\n");
        ctx.out.push_str(&fn_section);
    }

    (title, ctx.out)
}

// ---------------------------------------------------------------------------
// Glossary auto-linking (desktop: runs on rendered HTML before sending to view)
// ---------------------------------------------------------------------------

/// Parse `## Term` lines from a GLOSSARY.md file and return `(term, slug)` pairs,
/// sorted longest-term-first so multi-word terms match before their substrings.
fn parse_glossary_terms(path: &Path) -> Vec<(String, String)> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut terms: Vec<(String, String)> = content
        .lines()
        .filter_map(|line| {
            let text = line.strip_prefix("## ")?.trim();
            if text.is_empty() {
                return None;
            }
            let slug = tei_slugify(text);
            Some((text.to_string(), slug))
        })
        .collect();
    terms.sort_by(|a, b| b.0.len().cmp(&a.0.len())); // longest first
    terms
}

/// Walk the HTML body string and wrap term occurrences in glossary links,
/// skipping text inside `<a>`, `<code>`, or `<pre>` elements. Matches are
/// whole-word (Unicode letter/digit boundaries) and case-insensitive.
fn link_terms_in_html(html: &str, terms: &[(String, String)]) -> String {
    if terms.is_empty() {
        return html.to_string();
    }

    // Precompute each term's lowercased form and slug once (not per text run),
    // sorted longest-first so multi-word terms win over their substrings, and
    // index them by lowercased first byte so each scan position only tests the
    // handful of terms that could possibly start there.
    let mut prepared: Vec<(String, String)> = terms
        .iter()
        .map(|(term, slug)| (term.to_lowercase(), slug.clone()))
        .collect();
    prepared.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    let mut buckets: HashMap<u8, Vec<usize>> = HashMap::new();
    for (i, (lower, _)) in prepared.iter().enumerate() {
        if let Some(&first) = lower.as_bytes().first() {
            buckets.entry(first).or_default().push(i);
        }
    }

    let mut result = String::with_capacity(html.len() + html.len() / 4);
    let chars: &[u8] = html.as_bytes();
    let len = chars.len();
    let mut pos = 0;
    let mut skip_depth: i32 = 0; // inside a skipped element when > 0

    while pos < len {
        if chars[pos] == b'<' {
            // Find end of tag
            let tag_start = pos;
            let tag_end = html[pos..].find('>').map(|i| pos + i + 1).unwrap_or(len);
            let tag_text = &html[tag_start..tag_end];

            // Detect opening/closing of skip-tagged elements
            let tag_lower = tag_text.to_ascii_lowercase();
            for skip in &["<a", "<code", "<pre"] {
                if tag_lower.starts_with(skip)
                    && (tag_text.len() == skip.len()
                        || matches!(
                            tag_text.as_bytes().get(skip.len()),
                            Some(b' ' | b'>' | b'\n' | b'\r' | b'\t')
                        ))
                {
                    skip_depth += 1;
                    break;
                }
            }
            for skip in &["</a>", "</code>", "</pre>"] {
                if tag_lower.starts_with(skip) {
                    skip_depth = (skip_depth - 1).max(0);
                    break;
                }
            }

            result.push_str(tag_text);
            pos = tag_end;
        } else {
            // Collect a text run up to the next '<'
            let text_end = html[pos..].find('<').map(|i| pos + i).unwrap_or(len);
            let text_run = &html[pos..text_end];

            if skip_depth > 0 || text_run.is_empty() {
                result.push_str(text_run);
            } else {
                // Replace term occurrences in this text run
                result.push_str(&replace_terms_in_text(text_run, &prepared, &buckets));
            }
            pos = text_end;
        }
    }
    result
}

/// Replace term occurrences with `<a href="glossary:slug">term</a>` in a plain-text
/// run. `prepared` is the lowercased `(term, slug)` list (longest-first) and
/// `buckets` indexes it by lowercased first byte (both built once by the caller).
///
/// Matching is done against a lowercased copy of `text`, but every byte offset is
/// mapped back to the original through `orig` so slices always land on real char
/// boundaries. This matters because `to_lowercase()` can change a string's byte
/// length (and boundaries), so indexing the original with offsets taken from the
/// lowercased copy — as an earlier version did — panics on non-ASCII text, and
/// these documents are full of diacritics (Aṅga, Mahāpadma, Tuṣita, …).
fn replace_terms_in_text(
    text: &str,
    prepared: &[(String, String)],
    buckets: &HashMap<u8, Vec<usize>>,
) -> String {
    // Build the lowercased run alongside `orig`, where `orig[i]` is the original
    // byte offset that lowercased byte `i` came from. `orig` has one entry per
    // lowercased byte plus a trailing sentinel (`text.len()`), so any offset in
    // `0..=lower.len()` maps to a valid char boundary in `text`.
    let mut lower = String::with_capacity(text.len());
    let mut orig: Vec<usize> = Vec::with_capacity(text.len() + 1);
    for (off, ch) in text.char_indices() {
        let mut buf = [0u8; 4];
        for lc in ch.to_lowercase() {
            let s = lc.encode_utf8(&mut buf);
            for _ in 0..s.len() {
                orig.push(off);
            }
            lower.push_str(s);
        }
    }
    orig.push(text.len());
    let lower_bytes = lower.as_bytes();

    let mut result = String::with_capacity(text.len());
    let mut pos = 0usize; // byte offset into `lower`, always a char boundary
    while pos < lower.len() {
        let mut matched = false;
        if let Some(candidates) = buckets.get(&lower_bytes[pos]) {
            for &i in candidates {
                let (lower_term, slug) = &prepared[i];
                let end = pos + lower_term.len();
                if end > lower.len() || &lower_bytes[pos..end] != lower_term.as_bytes() {
                    continue;
                }
                // Whole-word: neither neighbour may be alphanumeric.
                let before_ok = pos == 0
                    || !lower[..pos]
                        .chars()
                        .next_back()
                        .map(char::is_alphanumeric)
                        .unwrap_or(false);
                let after_ok = end == lower.len()
                    || !lower[end..]
                        .chars()
                        .next()
                        .map(char::is_alphanumeric)
                        .unwrap_or(false);
                if !(before_ok && after_ok) {
                    continue;
                }
                // Emit the original (already HTML-encoded) span verbatim, so its
                // casing and any entities are preserved.
                let span = &text[orig[pos]..orig[end]];
                result.push_str(&format!(r#"<a href="glossary:{slug}">{span}</a>"#));
                pos = end;
                matched = true;
                break;
            }
        }
        if !matched {
            // Advance one original char: skip past every lowercased byte that came
            // from the same source char (a char may lowercase to several).
            let src = orig[pos];
            let mut next = pos + 1;
            while next < lower.len() && orig[next] == src {
                next += 1;
            }
            result.push_str(&text[src..orig[next]]);
            pos = next;
        }
    }
    result
}

/// Find the nearest `GLOSSARY.md` by walking up from `doc_dir` (the folder the
/// document lives in) toward the filesystem root. The glossary usually sits at a
/// project root many folders above the document — the same convention the
/// `glossary:` sheet links resolve against in `main.rs::nearest_glossary_file` —
/// so checking only the document's own folder would almost always miss it. A
/// lowercase `glossary.md` is accepted too, for case-sensitive trees.
fn nearest_glossary_file(doc_dir: &Path) -> Option<PathBuf> {
    let mut dir = Some(doc_dir);
    while let Some(folder) = dir {
        for name in ["GLOSSARY.md", "glossary.md"] {
            let candidate = folder.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        dir = folder.parent();
    }
    None
}

/// Find the nearest GLOSSARY.md at or above `doc_dir` and auto-link its terms in
/// `body_html`.
fn auto_link_glossary(body_html: String, doc_dir: &Path) -> String {
    let Some(glossary_path) = nearest_glossary_file(doc_dir) else {
        return body_html;
    };
    let terms = parse_glossary_terms(&glossary_path);
    if terms.is_empty() {
        return body_html;
    }
    link_terms_in_html(&body_html, &terms)
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

/// Build a minimap model from rendered block HTML. TEI/XML documents are rendered
/// straight to HTML with no Markdown source to line-scan, so [`build_minimap_model`]
/// has nothing to work from; without this the rail's canvas painter (which draws
/// from `spans`) had none and left the whole rail blank. Each top-level block
/// becomes one or more synthetic rows so the canvas paints a faithful outline:
/// headings as full bars, paragraphs and blockquotes sized to their text length,
/// lists by item count, code by line count. The viewport box is positioned from
/// the reader's real scroll range (see `measureDocumentMinimap` in the shell), so
/// these row counts only shape the cosmetic thumbnail — never the box.
pub fn build_minimap_model_from_html(html: &str) -> DocumentMinimap {
    let mut spans: Vec<MinimapSpan> = Vec::new();
    let mut next_line: usize = 0;
    collect_html_minimap_blocks(html, &mut spans, &mut next_line);
    DocumentMinimap {
        line_count: next_line,
        spans,
    }
}

/// Rows a run of body text occupies in the thumbnail, at the same characters-per-
/// line budget the Markdown model treats as a "long" line.
fn minimap_rows_for_text(chars: usize) -> usize {
    chars.div_ceil(MINIMAP_LONG_LINE_CHAR_THRESHOLD).max(1)
}

/// Visible-character count of an HTML fragment: tags stripped, whitespace runs
/// collapsed to one. Used only to size thumbnail rows, so an approximate count
/// (entities counted as their raw characters) is fine.
fn minimap_html_text_len(html: &str) -> usize {
    let mut count = 0;
    let mut in_tag = false;
    let mut prev_ws = false;
    for character in html.chars() {
        if in_tag {
            if character == '>' {
                in_tag = false;
            }
            continue;
        }
        if character == '<' {
            in_tag = true;
            continue;
        }
        if character.is_whitespace() {
            if !prev_ws {
                count += 1;
                prev_ws = true;
            }
            continue;
        }
        count += 1;
        prev_ws = false;
    }
    count
}

/// True when the character right after a matched `<tag` / `</tag` prefix is not a
/// letter or digit, i.e. the prefix is the whole tag name (`<p>` matches `<p`, but
/// `<pre>` does not).
fn minimap_tag_boundary(html: &str, index: usize) -> bool {
    html[index..]
        .chars()
        .next()
        .map_or(true, |character| !character.is_ascii_alphanumeric())
}

/// Count opening `<name …>` tags in `html` (whole-name matches only). The renderer
/// emits lowercase tags, so a lowercase scan suffices.
fn minimap_count_open_tags(html: &str, name: &str) -> usize {
    let pattern = format!("<{name}");
    let mut count = 0;
    let mut pos = 0;
    while let Some(offset) = html[pos..].find(&pattern) {
        let after = pos + offset + pattern.len();
        if minimap_tag_boundary(html, after) {
            count += 1;
        }
        pos = after;
    }
    count
}

/// Find the `</name>` that closes the `<name>` whose content starts at `open_end`,
/// accounting for nested same-name tags. Returns `(inner_start, inner_end,
/// after_close)`.
fn minimap_matching_close(
    html: &str,
    open_end: usize,
    name: &str,
) -> Option<(usize, usize, usize)> {
    let open_pattern = format!("<{name}");
    let close_pattern = format!("</{name}");
    let mut depth = 1usize;
    let mut pos = open_end;
    while pos < html.len() {
        let next_open = html[pos..].find(&open_pattern).map(|o| pos + o);
        let next_close = html[pos..].find(&close_pattern).map(|o| pos + o);
        match (next_open, next_close) {
            (_, None) => return None,
            (Some(open_at), Some(close_at)) if open_at < close_at => {
                let after = open_at + open_pattern.len();
                if minimap_tag_boundary(html, after) {
                    depth += 1;
                }
                pos = after;
            }
            (_, Some(close_at)) => {
                let after = close_at + close_pattern.len();
                if minimap_tag_boundary(html, after) {
                    depth -= 1;
                    let close_end = close_at + html[close_at..].find('>')? + 1;
                    if depth == 0 {
                        return Some((open_end, close_at, close_end));
                    }
                    pos = close_end;
                } else {
                    pos = after;
                }
            }
        }
    }
    None
}

/// Walk the top-level blocks of an HTML fragment, pushing one span per block (with
/// a one-row gap between blocks so they read as separate bars). Container blocks
/// (`section`, `div`, `article`) and unrecognized wrappers recurse so nested
/// content — e.g. footnote definitions — is still charted.
fn collect_html_minimap_blocks(html: &str, spans: &mut Vec<MinimapSpan>, next_line: &mut usize) {
    let mut cursor = 0;
    while cursor < html.len() {
        let Some(lt) = html[cursor..].find('<') else {
            break;
        };
        let start = cursor + lt;
        if html[start..].starts_with("<!--") {
            match html[start..].find("-->") {
                Some(offset) => cursor = start + offset + 3,
                None => break,
            }
            continue;
        }
        let name: String = html[start + 1..]
            .chars()
            .take_while(|character| character.is_ascii_alphanumeric())
            .collect();
        if name.is_empty() {
            cursor = start + 1;
            continue;
        }
        let Some(gt) = html[start..].find('>') else {
            break;
        };
        let open_end = start + gt + 1;
        let self_closing = html[start..open_end].ends_with("/>");
        let (inner, block_end) = if self_closing {
            ("", open_end)
        } else {
            match minimap_matching_close(html, open_end, &name) {
                Some((inner_start, inner_end, close_end)) => {
                    (&html[inner_start..inner_end], close_end)
                }
                None => (&html[open_end..], html.len()),
            }
        };
        push_html_minimap_block(&name, inner, spans, next_line);
        cursor = block_end;
    }
}

/// Classify one HTML block and append its span (or recurse into a container).
fn push_html_minimap_block(
    name: &str,
    inner: &str,
    spans: &mut Vec<MinimapSpan>,
    next_line: &mut usize,
) {
    use MinimapLineCategory::*;
    use MinimapLineStructure::*;

    let long_if = |chars: usize| {
        if chars >= MINIMAP_LONG_LINE_CHAR_THRESHOLD {
            Long
        } else {
            Short
        }
    };

    let (category, structure, rows) = match name {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => (Heading, Long, 1),
        "p" => {
            let chars = minimap_html_text_len(inner);
            (Paragraph, long_if(chars), minimap_rows_for_text(chars))
        }
        "blockquote" => {
            let chars = minimap_html_text_len(inner);
            (Blockquote, long_if(chars), minimap_rows_for_text(chars))
        }
        "ul" | "ol" => (List, Long, minimap_count_open_tags(inner, "li").max(1)),
        "pre" => (CodeFence, Long, inner.matches('\n').count() + 1),
        "section" | "div" | "article" => {
            collect_html_minimap_blocks(inner, spans, next_line);
            return;
        }
        _ => {
            if inner.contains('<') {
                collect_html_minimap_blocks(inner, spans, next_line);
                return;
            }
            let chars = minimap_html_text_len(inner);
            if chars == 0 {
                return;
            }
            (Paragraph, long_if(chars), minimap_rows_for_text(chars))
        }
    };

    spans.push(MinimapSpan {
        start_line: *next_line,
        line_count: rows,
        category,
        structure,
    });
    *next_line += rows + 1;
}

pub fn app_shell_html() -> String {
    APP_SHELL_HTML
        .replace("{{APP_SCRIPT}}", APP_SHELL_SCRIPT)
        .replace("{{THEME_BOOTSTRAP_SCRIPT}}", theme_bootstrap_script())
        .replace("{{LOCALE_BOOTSTRAP_SCRIPT}}", locale_bootstrap_script())
        .replace("{{READING_MODE_CSS}}", reading_mode_css())
        .replace(
            "{{MERMAID_SCRIPT_URL}}",
            &bundled_asset_url("mermaid.min.js"),
        )
        .replace(
            "{{KATEX_SCRIPT_URL}}",
            &bundled_asset_url("katex/katex.min.js"),
        )
        .replace(
            "{{KATEX_CSS_URL}}",
            &bundled_asset_url("katex/katex.min.css"),
        )
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
      'outline.title': 'Outline',
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
      'outline.title': '大纲',
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

/// Answer a hover tooltip's `countLines` request: hand the webview the line count
/// of the linked document for `token`. A negative count means "unknown" (the
/// target wasn't a readable local document), and the page just shows no count.
pub fn line_count_script(token: u64, lines: i64) -> String {
    format!("window.leafLineCount({token}, {lines});")
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

#[cfg(test)]
mod tests;
