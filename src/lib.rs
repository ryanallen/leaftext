//! Core document rendering and app-state helpers for leaftext.

pub mod indexer;
mod markdown;
mod tei;
pub(crate) use tei::*;
mod theme;
pub(crate) use markdown::*;
pub use markdown::{local_image_protocol_response, local_image_source_dir};
pub(crate) use theme::*;
mod scripts;
pub use scripts::*;
mod pager;
pub(crate) use pager::*;
pub use pager::{document_pager_html, pager_loaded_script};
mod minimap;
pub use minimap::{
    build_minimap_model, build_minimap_model_from_html, DocumentMinimap, MinimapLineCategory,
    MinimapLineStructure, MinimapSpan,
};
mod assets;
pub(crate) use assets::*;
pub use assets::{bundled_asset_response, BundledAsset, LOCAL_ASSET_PROTOCOL};
mod editing;
pub use editing::{
    block_source_map, kind_is_editable, render_source_view_html, task_marker_offsets, BlockSpan,
    DocumentFormat, EditableDocument,
};

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
const APP_SHELL_HTML: &str = include_str!("assets/app-shell.html");
const APP_SHELL_SCRIPT: &str = include_str!("assets/app-shell.js");
pub const LOCAL_IMAGE_PROTOCOL: &str = "leaf-image";
const LOCAL_IMAGE_HOST: &str = "local";
const LOCAL_IMAGE_PARENT_SEGMENT: &str = "__leaf_parent__";

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
    /// Source format, so the reading view knows how to anchor edits: Markdown
    /// blocks carry their ranges in the `blocks` array (attached to the rendered
    /// DOM positionally), while XML blocks carry `data-src-*` inline in `html`.
    pub format: DocumentFormat,
    /// Source byte ranges of the document's top-level blocks, in document order,
    /// for source-anchored in-viewer editing. Populated for Markdown; empty for
    /// XML (whose ranges are stamped inline on the HTML instead).
    #[serde(default)]
    pub blocks: Vec<BlockSpan>,
    /// Source byte offset of each list task marker's state character, in document
    /// order (see [`task_marker_offsets`]). Lets the reader make checkboxes
    /// interactive. Empty for XML, which has no Markdown task markers.
    #[serde(default)]
    pub tasks: Vec<usize>,
    /// The raw source text the blocks' byte ranges index into. Sent for XML so
    /// the reading view can present a block's exact source for editing (TEI can't
    /// be reconstructed from the rendered HTML). Empty for Markdown, whose blocks
    /// round-trip from the rendered DOM instead.
    #[serde(default)]
    pub source: String,
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

    let (title, body_html, blocks) = render_tei_document(xml);

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
        format: DocumentFormat::Xml,
        blocks,
        tasks: Vec::new(),
        source: xml.to_string(),
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
        format: DocumentFormat::Markdown,
        blocks: block_source_map(markdown),
        tasks: task_marker_offsets(markdown),
        // Sent so blocks that don't round-trip from the rendered DOM (lists,
        // tables, code, images, footnotes) can be edited as their exact Markdown
        // source in place; clean text blocks still edit WYSIWYG and ignore this.
        source: markdown.to_string(),
    }
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
        .replace("{{PIXI_SCRIPT_URL}}", &bundled_asset_url("pixi.min.js"))
        .replace(
            "{{PIXI_UNSAFE_EVAL_SCRIPT_URL}}",
            &bundled_asset_url("pixi-unsafe-eval.min.js"),
        )
        .replace(
            "{{D3_FORCE_SCRIPT_URL}}",
            &bundled_asset_url("d3-force.min.js"),
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
        .replace(
            "{{CODE_VIEW_ICON_SVG}}",
            normalize_svg_icon_colors(CODE_VIEW_ICON_SVG).trim(),
        )
        .replace(
            "{{DOCUMENT_ICON_SVG}}",
            normalize_svg_icon_colors(DOCUMENT_ICON_SVG).trim(),
        )
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
      'actions.codeView': 'View source',
      'actions.codeView.title': 'Toggle raw source view',
      'actions.save': 'Save',
      'actions.save.title': 'Save changes',
      'actions.undo': 'Undo',
      'actions.undo.title': 'Undo last edit',
      'reader.loading': 'Loading document…',
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
      'empty.title': 'Readable XML and Markdown',
      'errors.openFailed': 'Failed to open {path}: {reason}',
      'format.fileSizeUnknown': 'Unknown size',
      'library.title': 'Library',
      'library.view.toggle': 'Switch library view',
      'library.view.project': 'Project',
      'library.view.tree': 'Tree',
      'library.view.all': 'All files',
      'library.view.graph': 'Graph',
      'library.graph.empty': 'No links to graph yet.',
      'library.graph.loading': 'Building graph…',
      'library.graph.error': 'Graph failed to load.',
      'library.graph.truncated': 'Showing the {count} most-linked documents.',
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
      'library.search.scope.title': 'Toggle between searching only the files shown here and the whole library',
      'library.search.scope.all': 'All',
      'library.search.scope.focus': 'Focus',
      'recent.headingWithCount': 'Recent ({count})',
      'recent.openTitle': 'Open {path}',
      'minimap.aria': 'Document minimap',
      'outline.title': 'Outline',
      'outline.lineCount': '({count} lines)',
      'settings.heading': 'Settings',
      'settings.indexing.label': 'Index entire device',
      'settings.indexing.help': 'Crawl this device for Markdown and XML documents and rescan each time you open the app.',
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
      'settings.graphScope.aria': 'Graph size',
      'settings.graphScope.label': 'Graph size',
      'settings.graphScope.help': 'How many documents the graph view draws. Smaller is faster.',
      'settings.graphScope.small': 'Focus (open document + links)',
      'settings.graphScope.medium': 'Medium (up to 2,000)',
      'settings.graphScope.large': 'Large (up to 5,000)',
      'settings.graphScope.xl': 'Everything',
      'settings.speedReader.aria': 'Speed Reader',
      'settings.speedReader.help': 'Make prose quieter and add bold lead anchors for faster scanning.',
      'settings.speedReader.label': 'Speed Reader',
      'settings.lineNumbers.aria': 'Show line numbers',
      'settings.lineNumbers.help': 'Number each block in the left margin as a copyable permalink.',
      'settings.lineNumbers.label': 'Line numbers',
      'settings.readerEditing.aria': 'Edit in reading view',
      'settings.readerEditing.help': 'Click into the rendered page to edit it. Turn off to keep the reading view read-only; the code view still edits the source.',
      'settings.readerEditing.label': 'Edit in reading view',
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
      'actions.codeView': '查看源码',
      'actions.codeView.title': '切换源码视图',
      'actions.save': '保存',
      'actions.save.title': '保存更改',
      'actions.undo': '撤销',
      'actions.undo.title': '撤销上次编辑',
      'reader.loading': '正在加载文档…',
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
      'empty.title': '易读的 XML 与 Markdown',
      'errors.openFailed': '无法打开 {path}：{reason}',
      'format.fileSizeUnknown': '大小未知',
      'library.title': '文库',
      'library.view.toggle': '切换文库视图',
      'library.view.project': '项目',
      'library.view.tree': '目录树',
      'library.view.all': '全部文件',
      'library.view.graph': '关系图',
      'library.graph.empty': '暂无可用的链接关系。',
      'library.graph.loading': '正在生成关系图…',
      'library.graph.error': '关系图加载失败。',
      'library.graph.truncated': '仅显示链接最多的 {count} 个文档。',
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
      'library.search.scope.title': '在仅搜索此处显示的文件与搜索整个文库之间切换',
      'library.search.scope.all': '全部',
      'library.search.scope.focus': '聚焦',
      'recent.headingWithCount': '最近文件（{count}）',
      'recent.openTitle': '打开 {path}',
      'minimap.aria': '文档缩略图',
      'outline.title': '大纲',
      'outline.lineCount': '（{count} 行）',
      'settings.heading': '设置',
      'settings.indexing.label': '索引整个设备',
      'settings.indexing.help': '扫描此设备上的 Markdown 和 XML 文档，并在每次打开应用时重新扫描。',
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
      'settings.graphScope.aria': '关系图规模',
      'settings.graphScope.label': '关系图规模',
      'settings.graphScope.help': '关系图绘制的文档数量。规模越小越快。',
      'settings.graphScope.small': '聚焦（当前文档及其链接）',
      'settings.graphScope.medium': '中等（最多 2,000）',
      'settings.graphScope.large': '大（最多 5,000）',
      'settings.graphScope.xl': '全部',
      'settings.speedReader.aria': '快速阅读',
      'settings.speedReader.help': '弱化正文干扰，并为词首添加加粗引导，方便快速浏览。',
      'settings.speedReader.label': '快速阅读',
      'settings.lineNumbers.aria': '显示行号',
      'settings.lineNumbers.help': '在左侧页边为每个区块标注可复制的固定链接编号。',
      'settings.lineNumbers.label': '行号',
      'settings.readerEditing.aria': '在阅读视图中编辑',
      'settings.readerEditing.help': '点击渲染后的页面即可直接编辑。关闭后阅读视图为只读；源代码视图仍可编辑源文件。',
      'settings.readerEditing.label': '在阅读视图中编辑',
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
    /// Whether to show the gutter permalink number beside each block in the
    /// reading view. On by default; turning it off hides the numbers (the blocks
    /// keep their ids, so `#locus` deep links still resolve).
    pub line_numbers_enabled: bool,
    /// Whether the reading view is a live editor (click a block to edit it,
    /// toggle task checkboxes). On by default; turning it off keeps the rendered
    /// page read-only. The code view still edits the raw source regardless.
    pub reader_editing_enabled: bool,
    /// The theme mode the frontend last selected: `system`, `light`, `dark`, or
    /// `dracula`. Stored as the raw mode string the frontend understands; the
    /// frontend normalizes anything unexpected back to `system`.
    pub theme_mode: String,
    /// Which library view is showing: drill-in Project, expandable Tree, or flat.
    pub library_view: LibraryView,
    /// How much of the link graph the graph view draws (see [`GraphScope`]).
    pub graph_scope: GraphScope,
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
    /// The window's last inner size in logical (DPI-independent) px, so it reopens
    /// at the size the user left it. Stored logically so it round-trips correctly
    /// across monitors with different scale factors.
    pub window_width: u32,
    pub window_height: u32,
    /// Whether the window was maximized when it last closed, restored on launch.
    /// Tracked separately from the size so un-maximizing returns to the windowed
    /// dimensions rather than the maximized ones.
    pub window_maximized: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            indexing_enabled: false,
            minimap_enabled: true,
            pager_enabled: true,
            speed_reader_enabled: false,
            line_numbers_enabled: true,
            reader_editing_enabled: true,
            theme_mode: "system".to_string(),
            library_view: LibraryView::default(),
            graph_scope: GraphScope::default(),
            library_expanded: Vec::new(),
            library_project_path: String::new(),
            library_closed: false,
            library_width: 240,
            window_width: 1080,
            window_height: 820,
            window_maximized: false,
        }
    }
}

/// The library pane's layouts. Serialized lowercase (`"graph"`, `"project"`,
/// `"tree"`, `"flat"`) to match the frontend's `LIBRARY_VIEWS` strings. Graph is
/// the default view.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryView {
    #[default]
    Graph,
    Project,
    Tree,
    Flat,
}

impl LibraryView {
    pub fn as_str(self) -> &'static str {
        match self {
            LibraryView::Graph => "graph",
            LibraryView::Project => "project",
            LibraryView::Tree => "tree",
            LibraryView::Flat => "flat",
        }
    }

    /// Parse a value sent by the frontend, ignoring anything unrecognized.
    pub fn from_client(value: &str) -> Option<Self> {
        match value {
            "graph" => Some(LibraryView::Graph),
            "project" => Some(LibraryView::Project),
            "tree" => Some(LibraryView::Tree),
            "flat" => Some(LibraryView::Flat),
            _ => None,
        }
    }
}

/// How much of the link graph the graph view draws. `Small` focuses on the open
/// document — or the recent files, on the start screen — plus everything one link
/// away; the rest cap the densest documents at increasing sizes, up to `Xl`
/// (every indexed document). Serialized lowercase to match the frontend's
/// `GRAPH_SCOPES` strings. Small is the default so the graph opens fast.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphScope {
    #[default]
    Small,
    Medium,
    Large,
    Xl,
}

impl GraphScope {
    pub fn as_str(self) -> &'static str {
        match self {
            GraphScope::Small => "small",
            GraphScope::Medium => "medium",
            GraphScope::Large => "large",
            GraphScope::Xl => "xl",
        }
    }

    /// Parse a value sent by the frontend, ignoring anything unrecognized.
    pub fn from_client(value: &str) -> Option<Self> {
        match value {
            "small" => Some(GraphScope::Small),
            "medium" => Some(GraphScope::Medium),
            "large" => Some(GraphScope::Large),
            "xl" => Some(GraphScope::Xl),
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

#[cfg(test)]
mod tests;
