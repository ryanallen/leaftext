//! Core document rendering and app-state helpers for leaftext.

pub mod indexer;
mod markdown;
mod tei;
pub(crate) use tei::*;
mod xml;
pub(crate) use xml::*;
mod data;
pub(crate) use data::*;
mod theme;
pub(crate) use markdown::*;
pub use markdown::{is_local_image_path, local_image_protocol_response, local_image_source_dir};
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
mod updater;
pub use updater::{
    hash_file, is_newer_version, now_unix, platform_asset_suffix, prune_staged, read_staged,
    record_apply_outcome, staging_dir, take_apply_outcome, update_check_is_due,
    update_url_is_allowed, updates_dir, ApplyOutcome, StagedUpdate, UpdateDownload,
    MAX_UPDATE_BYTES, UPDATE_CHECK_INTERVAL_SECS,
};

use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fmt, fs, io,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use ammonia::Builder;
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
/// Marks a `leaf-image://` URL carrying a whole absolute path, for an image that
/// does not sit under the open document's folder.
const LOCAL_IMAGE_ABSOLUTE_SEGMENT: &str = "__leaf_absolute__";

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
    /// Source format, so the reading view knows how to anchor edits. Markdown
    /// blocks carry ranges in `blocks` (positional on the DOM); the tree formats
    /// carry `data-src-*` inline in `html`.
    pub format: DocumentFormat,
    /// Top-level block source ranges in document order, for in-viewer editing.
    /// Markdown only; the tree formats stamp ranges inline on the HTML.
    #[serde(default)]
    pub blocks: Vec<BlockSpan>,
    /// Source byte offset of each list task marker's state char, in document
    /// order (see [`task_marker_offsets`]). Markdown only.
    #[serde(default)]
    pub tasks: Vec<usize>,
    /// The raw source the block ranges index into. Sent for the tree formats
    /// (TEI and a data file can't be reconstructed from the HTML); empty for
    /// Markdown, which round-trips from the DOM.
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

    /// Collapse entries to normalized form, dropping duplicates in order. Run on
    /// load so the same file recorded under different spellings self-heals.
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

/// Resolve `.` and `..` in `path` lexically (not via the filesystem) so two
/// spellings of the same file collapse to one Recent entry. Lexical rather than
/// canonicalized keeps the path human-readable (no `\\?\` prefix) and usable by
/// OS file-reveal commands.
fn normalize_recent_path(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            // Only pop a real segment; a `..` that escapes the root can't be
            // resolved lexically, so keep it verbatim.
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
    let source = fs::read_to_string(path)?;
    Ok(opened_document_from_source(&source, path))
}

/// Render source already in hand, picking the renderer by the path's format: the
/// counterpart to [`load_document`] for live reload's hash-gated bytes and the
/// code view's unsaved edits. The one routing table, because a second one drifts.
pub fn opened_document_from_source(source: &str, path: impl AsRef<Path>) -> OpenedDocument {
    let path = path.as_ref();
    match DocumentFormat::from_path(path) {
        DocumentFormat::Xml => opened_document_from_xml(source, path),
        DocumentFormat::Json => opened_document_from_json(source, path),
        DocumentFormat::Yaml => opened_document_from_yaml(source, path),
        DocumentFormat::Markdown => opened_document_from_markdown(source, path),
    }
}

/// Load an XML document from disk and render it to an `OpenedDocument`. TEI and
/// everything else both come through here; the renderer picks by content.
pub fn load_xml_document(path: impl AsRef<Path>) -> io::Result<OpenedDocument> {
    let path = path.as_ref();
    let xml = fs::read_to_string(path)?;
    Ok(opened_document_from_xml(&xml, path))
}

/// Render an XML string into an `OpenedDocument`: TEI through the TEI renderer,
/// any other XML through the generic one.
pub fn opened_document_from_xml(xml: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_tree(xml, path.as_ref(), DocumentFormat::Xml, render_xml_document)
}

/// Render a JSON string into an `OpenedDocument`.
pub fn opened_document_from_json(json: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_tree(
        json,
        path.as_ref(),
        DocumentFormat::Json,
        render_json_document,
    )
}

/// Render a YAML string into an `OpenedDocument`.
pub fn opened_document_from_yaml(yaml: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_tree(
        yaml,
        path.as_ref(),
        DocumentFormat::Yaml,
        render_yaml_document,
    )
}

/// Render a document that is a tree rather than prose — XML, JSON, YAML — into an
/// `OpenedDocument`. They differ only in the reader that turns source into HTML;
/// the shell around it is the same, and none of them can be reconstructed from
/// the DOM, so each sends its `source` along.
fn opened_document_from_tree(
    source: &str,
    path: &Path,
    format: DocumentFormat,
    render: impl Fn(&str, Option<&str>) -> (Option<String>, String, Vec<BlockSpan>),
) -> OpenedDocument {
    let render_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    // A document with no title of its own is titled by its file name, which the
    // renderer also heads the page with (a sitemap, or a lock file, has nowhere
    // else to say what it is).
    let fallback_title = render_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(plain_document_title)
        .map(|stem| xml_fallback_title(&stem));

    let (title, body_html, blocks) = render(source, fallback_title.as_deref());

    let title = title
        .or(fallback_title)
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

    // Chart the rendered block HTML (there is no Markdown source to line-scan),
    // before wrapping in the <article>/pager shell so the scan sees only content.
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
        format,
        blocks,
        tasks: Vec::new(),
        source: source.to_string(),
    }
}

/// Render an already-loaded markdown string into an `OpenedDocument`. Split out
/// from [`load_document`] so live-reload can read the file once and reuse the
/// string rather than reading twice.
pub fn opened_document_from_markdown(markdown: &str, path: impl AsRef<Path>) -> OpenedDocument {
    let path = path.as_ref();
    let render_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let rendered = render_markdown_document(markdown, &render_path);

    // Placeholder; the real Previous/Next pager scans the folder tree after the
    // document is on screen.
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
        // Lets blocks that don't round-trip from the DOM (lists, tables, code,
        // images, footnotes) edit their exact source; text blocks ignore it.
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
    // Detect the title past any leading frontmatter, so the tab title is the
    // document's real heading, not the `---` metadata.
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
    // Auto-link glossary terms from the nearest GLOSSARY.md (occurrences already
    // inside a link or code are left alone). Skip the glossary file itself.
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

// Glossary auto-linking: runs on rendered HTML before sending to the view.

/// Parse `## Term` lines from a GLOSSARY.md into `(term, slug)` pairs, sorted
/// longest-first so multi-word terms match before their substrings.
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

    // Precompute lowercased term + slug once (not per run), longest-first, and
    // bucket by lowercased first byte so each scan position tests only the few
    // terms that could start there.
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

/// Replace term occurrences with `<a href="glossary:slug">term</a>` in a plain
/// text run. Matching runs against a lowercased copy of `text`, with every
/// offset mapped back through `orig` to a real char boundary — `to_lowercase()`
/// can change byte length, so indexing the original with lowercased offsets
/// would panic on the diacritics these documents are full of.
fn replace_terms_in_text(
    text: &str,
    prepared: &[(String, String)],
    buckets: &HashMap<u8, Vec<usize>>,
) -> String {
    // `orig[i]` is the original byte offset lowercased byte `i` came from, with
    // a trailing sentinel, so any offset in `0..=lower.len()` maps to a valid
    // char boundary in `text`.
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
                // Emit the original span verbatim, preserving casing and entities.
                let span = &text[orig[pos]..orig[end]];
                result.push_str(&format!(r#"<a href="glossary:{slug}">{span}</a>"#));
                pos = end;
                matched = true;
                break;
            }
        }
        if !matched {
            // Advance one original char (one source char may lowercase to several).
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

/// Find the nearest `GLOSSARY.md` by walking up from `doc_dir` to the root (the
/// glossary usually sits at a project root well above the document). A lowercase
/// `glossary.md` is accepted too, for case-sensitive trees.
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
        .replace("{{THEME_BOOTSTRAP_SCRIPT}}", &theme_bootstrap_script())
        .replace("{{LOCALE_BOOTSTRAP_SCRIPT}}", locale_bootstrap_script())
        .replace("{{APP_CSS_URL}}", &bundled_asset_url("app.css"))
        .replace("{{THEME_ITEMS}}", &theme_items_html())
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
        .replace(
            "{{LEAF_ICON_SVG}}",
            normalize_svg_icon_colors(LEAF_ICON_SVG).trim(),
        )
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
        .replace(
            "{{GRAPH_ICON_SVG}}",
            normalize_svg_icon_colors(GRAPH_ICON_SVG).trim(),
        )
}

/// The theme picker's family buttons for the selector bottom sheet, one per
/// family, rendered from [`theme_families`] so the built-in list stays the
/// single source of truth. Family names are trusted (proper nouns defined in
/// `theme.rs`), ids are `[a-z0-9-]`.
/// Selected-state check badge shown on the active theme card (Heroicons
/// check-circle, stroked in the accent color via `currentColor`). Hidden until
/// the card is `.is-active`.
const THEME_ITEM_CHECK_SVG: &str = "<svg class=\"theme-item-check\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\" stroke-width=\"1.5\" stroke=\"currentColor\" aria-hidden=\"true\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z\" /></svg>";

fn theme_items_html() -> String {
    let mut items: String = theme_families()
        .into_iter()
        .map(|(id, name)| {
            format!(
                "<li><button type=\"button\" class=\"theme-item\" data-family=\"{id}\" aria-pressed=\"false\"><span class=\"theme-item-name\">{name}</span>{THEME_ITEM_CHECK_SVG}</button></li>"
            )
        })
        .collect();
    // "Random" is not a real family: it's a preference the bootstrap resolves to a
    // concrete family at each launch, cycling through every family without repeat
    // before resetting. Appended after the families; localized via data-i18n.
    items.push_str(
        &format!("<li><button type=\"button\" class=\"theme-item theme-item-random\" data-family=\"random\" aria-pressed=\"false\"><span class=\"theme-item-name\" data-i18n=\"settings.theme.family.random\">Random</span>{THEME_ITEM_CHECK_SVG}</button></li>"),
    );
    items
}

fn theme_bootstrap_script() -> String {
    r#"
(() => {
  // Themes are two axes: a family (github/nightshade/amaranth/…) and an appearance
  // mode. Light/dark pick a fixed variant, system follows the OS, and daylight
  // is light between DAY_START and DAY_END local time, dark otherwise.
  // The built-in theme families, injected from the theme registry (theme.rs
  // theme_families) so this list can never drift from the registered sources.
  const VALID_FAMILIES = new Set({{VALID_FAMILIES}});
  // The concrete families the 'random' preference draws from, in registration
  // order. 'random' is a preference, never itself a concrete family.
  const REAL_FAMILIES = Array.from(VALID_FAMILIES);
  const RANDOM = 'random';
  const VALID_MODES = new Set(['system', 'light', 'dark', 'daylight']);
  const FAMILY_FALLBACK = 'fern';
  const MODE_FALLBACK = 'system';
  // Family -> Google Fonts stylesheet URL. Fonts are fetched from Google (never
  // bundled); only the active family's font is requested and WebView2 caches it.
  // Families absent from the map (e.g. github) use the OS's native fonts.
  const FAMILY_FONTS = {{FAMILY_FONTS}};
  const DAY_START = 9;
  const DAY_END = 18;
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const listeners = new Set();
  const normalizeFamily = (value) => (VALID_FAMILIES.has(value) ? value : FAMILY_FALLBACK);
  // The picker preference is a concrete family or the special 'random', which
  // resolves to a concrete family at launch (and each time it is re-picked).
  const normalizePreference = (value) => (value === RANDOM ? RANDOM : normalizeFamily(value));
  const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);
  // The host injects the persisted theme as window.__leafSettings before this
  // runs, so the theme resolves on the first paint. The host owns persistence;
  // the app shell's opaque origin can't use localStorage.
  const settings = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};
  // Families already shown in the current random cycle, persisted by the host so
  // the no-repeat run survives restarts. Ask the host to save the bag whenever a
  // draw mutates it; wry's window.ipc is ready before this inline script runs.
  let randomBag = Array.isArray(settings.themeRandomUsed)
    ? settings.themeRandomUsed.filter((fam) => VALID_FAMILIES.has(fam))
    : [];
  const persistRandomBag = () => {
    if (window.ipc && typeof window.ipc.postMessage === 'function') {
      window.ipc.postMessage(JSON.stringify({ command: 'setThemeRandomBag', used: randomBag }));
    }
  };
  // Draw the next family at random, not repeating until every family has shown,
  // then reset — while avoiding an immediate repeat of the just-shown family
  // across the reset. Mutates and persists the bag.
  const drawRandomFamily = () => {
    let available = REAL_FAMILIES.filter((fam) => !randomBag.includes(fam));
    if (available.length === 0) {
      const last = randomBag[randomBag.length - 1];
      randomBag = [];
      available = REAL_FAMILIES.filter((fam) => fam !== last);
      if (available.length === 0) { available = REAL_FAMILIES.slice(); }
    }
    const choice = available[Math.floor(Math.random() * available.length)];
    randomBag = randomBag.concat([choice]);
    persistRandomBag();
    return choice;
  };
  // Two axes of family state: the persisted preference (drives the picker and may
  // be 'random') and the concrete family actually applied (drives the CSS).
  let familyPreference = normalizePreference(settings.themeFamily);
  let family = familyPreference === RANDOM ? drawRandomFamily() : familyPreference;
  let mode = normalizeMode(settings.themeMode);

  const isDaytime = () => {
    const hour = new Date().getHours();
    return hour >= DAY_START && hour < DAY_END;
  };
  const resolvedTheme = () => {
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    if (mode === 'daylight') return isDaytime() ? 'light' : 'dark';
    return media && media.matches ? 'dark' : 'light';
  };
  const snapshot = () => ({ family, mode, resolvedTheme: resolvedTheme() });
  // Point a single <link> at the active family's Google Fonts stylesheet, so the
  // font is fetched and applied on activation and swaps when the theme changes.
  // Families with no entry (system-font themes) get the link removed.
  const applyFamilyFont = (fam) => {
    const href = FAMILY_FONTS[fam];
    let link = document.getElementById('leafThemeFont');
    if (!href) { if (link) { link.remove(); } return; }
    if (!link) {
      link = document.createElement('link');
      link.id = 'leafThemeFont';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) { link.setAttribute('href', href); }
  };
  const apply = () => {
    const theme = snapshot();
    // The Leaf-owned attributes that drive the compiled theme CSS.
    root.dataset.leafTheme = family;
    root.dataset.leafAppearance = theme.resolvedTheme;
    root.dataset.themeMode = mode;
    root.dataset.themeFamily = family;
    root.dataset.theme = theme.resolvedTheme;
    root.style.colorScheme = theme.resolvedTheme;
    applyFamilyFont(family);
    listeners.forEach((listener) => listener(theme));
  };

  // Daylight boundary timer: re-apply at the next DAY_START/DAY_END crossing so
  // the appearance flips without a restart. Rescheduled after each fire, and
  // cleared whenever the mode leaves daylight.
  let daylightTimer = 0;
  const scheduleDaylight = () => {
    if (daylightTimer) { clearTimeout(daylightTimer); daylightTimer = 0; }
    if (mode !== 'daylight') return;
    const now = new Date();
    const next = new Date(now);
    const hour = now.getHours();
    if (hour < DAY_START) { next.setHours(DAY_START, 0, 0, 0); }
    else if (hour < DAY_END) { next.setHours(DAY_END, 0, 0, 0); }
    else { next.setDate(next.getDate() + 1); next.setHours(DAY_START, 0, 0, 0); }
    const delay = Math.max(1000, next.getTime() - now.getTime());
    daylightTimer = setTimeout(() => { apply(); scheduleDaylight(); }, delay);
  };

  window.leafTheme = {
    getMode: () => mode,
    getFamily: () => familyPreference,
    getResolvedTheme: resolvedTheme,
    setMode(nextMode) {
      mode = normalizeMode(nextMode);
      apply();
      scheduleDaylight();
    },
    setFamily(nextFamily) {
      familyPreference = normalizePreference(nextFamily);
      family = familyPreference === RANDOM ? drawRandomFamily() : familyPreference;
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
  // A machine that slept across a boundary wakes with a stale appearance; re-run
  // the clock check (and reschedule) when the window regains focus.
  window.addEventListener('focus', () => { if (mode === 'daylight') { apply(); scheduleDaylight(); } });

  apply();
  scheduleDaylight();
})();
"#
    .replace("{{VALID_FAMILIES}}", &theme_family_ids_json())
    .replace("{{FAMILY_FONTS}}", &theme_web_font_hrefs_json())
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
      'actions.more': 'More options',
      'reader.loading': 'Loading document…',
      'actions.revealFile': 'Reveal file',
      'actions.cut': 'Cut',
      'actions.copy': 'Copy',
      'actions.copyPath': 'Copy path',
      'actions.rename': 'Rename',
      'actions.properties': 'Properties',
      'actions.getInfo': 'Get Info',
      'actions.delete': 'Delete',
      'empty.description': 'Open a file and read it in peace. It stays on your device, in plain text you own.',
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
      'empty.noRecent': 'Files you open show up here, so you can pick up where you left off.',
      'empty.title': 'Refine your mind.',
      'empty.subtitle': 'Your thoughts, secure and free.',
      'errors.openFailed': 'Failed to open {path}: {reason}',
      'format.fileSizeUnknown': 'Unknown size',
      'library.title': 'Library',
      'library.view.graph': 'Graph',
      'library.view.graph.on': 'Show how these documents link',
      'library.view.graph.off': 'Back to the file list',
      'library.crumbs.label': 'Folder path',
      'library.crumbs.enter': 'Open {name}',
      'library.crumbs.more': 'Skipped folders: {names}',
      'library.graph.empty': 'No links to graph yet.',
      'library.graph.loading': 'Building graph…',
      'library.graph.error': 'Graph failed to load.',
      'library.graph.truncated': 'Showing the {count} most-linked documents.',
      'library.scanning': 'Scanning…',
      'library.filesFound': '{count} files found',
      'library.empty': 'No Markdown indexed yet.',
      'library.open': 'Library',
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
      'outline.lineCount': '({count} lines)',
      'settings.heading': 'Settings',
      'update.available': 'Update to v{version}',
      'update.downloading': 'Downloading v{version}… {percent}%',
      'update.restart': 'Restart to update',
      'update.failed': 'Update failed — open release page',
      'update.failedReason': 'Update failed: {message}',
      'update.title': 'A new version is available',
      'update.check': 'Check for updates',
      'update.checkTitle': 'Ask GitHub for the latest release now',
      'update.checking': 'Checking…',
      'update.upToDate': 'Up to date.',
      'update.lastChecked': 'Last checked {when}.',
      'update.checkedNow': 'Checked just now.',
      'update.checkFailed': 'Could not reach GitHub: {message}',
      'update.applyFailed': 'Installing v{version} failed: {message}',
      'update.httpError': 'GitHub answered {status}',
      'update.downloadsOff': 'Downloads are off — the button opens the release page.',
      'update.noInstaller': 'This release publishes no installer for this platform — the button opens the release page.',
      'settings.autoUpdate.aria': 'Download updates',
      'settings.autoUpdate.label': 'Update automatically',
      'settings.autoUpdate.help': 'Download new versions in the background and install them the next time you open the app. Off checks for updates but only links to the download page.',
      'settings.version': 'Version',
      'settings.indexing.label': 'Index entire device',
      'settings.indexing.help': 'Crawl this device for Markdown and XML documents and rescan each time you open the app.',
      'settings.theme.appearance': 'Appearance',
      'settings.theme.aria': 'Theme',
      'settings.theme.dark': 'Dark',
      'settings.theme.daylight': 'Daylight',
      'settings.theme.family.amaranth': 'Amaranth',
      'settings.theme.family.fern': 'Fern',
      'settings.theme.family.github': 'GitHub',
      'settings.theme.family.halcyon': 'Halcyon',
      'settings.theme.family.nightshade': 'Nightshade',
      'settings.theme.family.sage': 'Sage',
      'settings.theme.family.random': 'Random',
      'settings.theme.help': 'System follows device preference; Daylight is light by day, dark at night.',
      'settings.theme.label': 'Theme',
      'settings.theme.light': 'Light',
      'settings.theme.sheet.browse': 'Add your own theme on GitHub →',
      'settings.theme.sheet.close': 'Close',
      'settings.theme.sheet.title': 'Themes',
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
      'actions.more': '更多选项',
      'reader.loading': '正在加载文档…',
      'actions.revealFile': '在文件管理器中显示',
      'actions.cut': '剪切',
      'actions.copy': '复制',
      'actions.copyPath': '复制路径',
      'actions.rename': '重命名',
      'actions.properties': '属性',
      'actions.getInfo': '显示简介',
      'actions.delete': '删除',
      'empty.description': '打开一个文件，静心阅读。它只留在你的设备上，是你自己拥有的纯文本。',
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
      'empty.noRecent': '你打开过的文件会显示在这里，方便随时接着读。',
      'empty.title': '打磨你的思想。',
      'empty.subtitle': '你的思绪，安全而自由。',
      'errors.openFailed': '无法打开 {path}：{reason}',
      'format.fileSizeUnknown': '大小未知',
      'library.title': '文库',
      'library.view.graph': '关系图',
      'library.view.graph.on': '查看这些文档的链接关系',
      'library.view.graph.off': '返回文件列表',
      'library.crumbs.label': '文件夹路径',
      'library.crumbs.enter': '打开 {name}',
      'library.crumbs.more': '省略的文件夹：{names}',
      'library.graph.empty': '暂无可用的链接关系。',
      'library.graph.loading': '正在生成关系图…',
      'library.graph.error': '关系图加载失败。',
      'library.graph.truncated': '仅显示链接最多的 {count} 个文档。',
      'library.scanning': '正在扫描…',
      'library.filesFound': '已找到 {count} 个文件',
      'library.empty': '尚未索引任何 Markdown 文件。',
      'library.open': '文库',
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
      'outline.lineCount': '（{count} 行）',
      'settings.heading': '设置',
      'update.available': '更新到 v{version}',
      'update.downloading': '正在下载 v{version}… {percent}%',
      'update.restart': '重启以更新',
      'update.failed': '更新失败 — 打开发布页面',
      'update.failedReason': '更新失败：{message}',
      'update.title': '有新版本可用',
      'update.check': '检查更新',
      'update.checkTitle': '立即向 GitHub 查询最新版本',
      'update.checking': '正在检查…',
      'update.upToDate': '已是最新版本。',
      'update.lastChecked': '上次检查：{when}。',
      'update.checkedNow': '刚刚检查过。',
      'update.checkFailed': '无法连接 GitHub：{message}',
      'update.applyFailed': '安装 v{version} 失败：{message}',
      'update.httpError': 'GitHub 返回 {status}',
      'update.downloadsOff': '下载已关闭 — 此按钮会打开发布页面。',
      'update.noInstaller': '此版本没有发布适用于该平台的安装包 — 此按钮会打开发布页面。',
      'settings.autoUpdate.aria': '下载更新',
      'settings.autoUpdate.label': '自动更新',
      'settings.autoUpdate.help': '在后台下载新版本，并在下次打开应用时自动安装。关闭后仍会检查更新，但只提供下载页面链接。',
      'settings.version': '版本',
      'settings.indexing.label': '索引整个设备',
      'settings.indexing.help': '扫描此设备上的 Markdown 和 XML 文档，并在每次打开应用时重新扫描。',
      'settings.theme.appearance': '外观',
      'settings.theme.aria': '主题',
      'settings.theme.dark': '深色',
      'settings.theme.daylight': '日间自动',
      'settings.theme.family.amaranth': 'Amaranth',
      'settings.theme.family.fern': 'Fern',
      'settings.theme.family.github': 'GitHub',
      'settings.theme.family.halcyon': 'Halcyon',
      'settings.theme.family.nightshade': 'Nightshade',
      'settings.theme.family.sage': 'Sage',
      'settings.theme.family.random': '随机',
      'settings.theme.help': '跟随系统显示偏好；“日间自动”白天浅色、夜间深色。',
      'settings.theme.label': '主题',
      'settings.theme.light': '浅色',
      'settings.theme.sheet.browse': '在 GitHub 上添加你的主题 →',
      'settings.theme.sheet.close': '关闭',
      'settings.theme.sheet.title': '主题',
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

/// Reverse-DNS app id, and the two halves it is built from. macOS names the
/// per-app folder with the whole id; Windows nests organization inside
/// application. Both spellings are load-bearing: they are where every existing
/// install already keeps its settings, recent files, and search index.
/// Only macOS spells the qualifier into a path; Windows ignores it entirely.
#[cfg(target_os = "macos")]
const APP_QUALIFIER: &str = "com";
const APP_ORGANIZATION: &str = "ryanallen";
const APP_NAME: &str = "leaftext";

/// Roaming per-user configuration root.
///
/// Windows: `%APPDATA%\ryanallen\leaftext\config`.
/// macOS: `~/Library/Application Support/com.ryanallen.leaftext`.
///
/// These reproduce, exactly, the layout the `directories` crate produced for
/// `ProjectDirs::from("com", "ryanallen", "leaftext")` — including the `config`
/// leaf on Windows, which is easy to miss and would strand every existing
/// user's settings if it were dropped. [`project_dirs_match_the_documented_layout`]
/// pins both.
pub fn project_config_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Some(
            PathBuf::from(std::env::var_os("APPDATA")?)
                .join(APP_ORGANIZATION)
                .join(APP_NAME)
                .join("config"),
        )
    }
    #[cfg(target_os = "macos")]
    {
        Some(macos_application_support_dir()?)
    }
}

/// Machine-local per-user data root (WebView2's cache and the search index).
///
/// Windows: `%LOCALAPPDATA%\ryanallen\leaftext\data`.
/// macOS: `~/Library/Application Support/com.ryanallen.leaftext`, which is the
/// same folder as the config root — the platform draws no roaming distinction.
pub fn project_data_local_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Some(
            PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
                .join(APP_ORGANIZATION)
                .join(APP_NAME)
                .join("data"),
        )
    }
    #[cfg(target_os = "macos")]
    {
        Some(macos_application_support_dir()?)
    }
}

#[cfg(target_os = "macos")]
fn macos_application_support_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").filter(|home| !home.is_empty())?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(format!("{APP_QUALIFIER}.{APP_ORGANIZATION}.{APP_NAME}")),
    )
}

pub fn config_file_path() -> Option<PathBuf> {
    project_config_dir().map(|dir| dir.join("recent-files.json"))
}

pub fn webview_user_data_dir() -> Option<PathBuf> {
    project_data_local_dir().map(|dir| dir.join("webview2"))
}

/// The app data root for leaftext's own files (the indexer manifest lives here).
/// The local data dir itself, not the WebView2 cache subfolder, so the manifest
/// isn't entangled with the browser's storage.
pub fn app_data_dir() -> Option<PathBuf> {
    project_data_local_dir()
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

/// UI toggles that survive a restart. The app shell's opaque origin can't use
/// localStorage, so the host owns these: injected on boot via
/// [`initial_settings_script`] and saved whenever the frontend reports a change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub indexing_enabled: bool,
    pub minimap_enabled: bool,
    /// Append the automatic Previous/Next pager to every document. On by default.
    pub pager_enabled: bool,
    /// Quiet prose and add bold lead anchors at word starts. Off by default.
    pub speed_reader_enabled: bool,
    /// Show the gutter permalink number beside each block. Off by default; the
    /// blocks keep their ids either way, so `#locus` deep links still resolve.
    pub line_numbers_enabled: bool,
    /// Make the reading view a live editor. On by default; off keeps it
    /// read-only. The code view edits the raw source regardless.
    pub reader_editing_enabled: bool,
    /// Selected theme family: `github`/`nightshade`/`amaranth`/… Raw frontend
    /// string; the frontend normalizes anything unexpected back to `github`.
    pub theme_family: String,
    /// Last appearance mode: `system`/`light`/`dark`/`daylight`. Raw frontend
    /// string; the frontend normalizes anything unexpected back to `system`.
    pub theme_mode: String,
    /// Families already shown in the current random-theme cycle. When the theme
    /// family is `random`, the frontend draws a fresh family at each launch and
    /// appends it here so none repeats until every family has shown, then resets.
    pub theme_random_used: Vec<String>,
    /// Which library view is showing: the Project file list or the Graph.
    pub library_view: LibraryView,
    /// How much of the link graph the graph view draws (see [`GraphScope`]).
    pub graph_scope: GraphScope,
    /// The folder Project view is inside (empty string = the root). Restored on
    /// launch, so the pane reopens where it was left.
    pub library_project_path: String,
    /// Whether the library pane is collapsed shut. Open by default.
    pub library_closed: bool,
    /// The pane's last open width in CSS px. The frontend re-clamps it to the
    /// window, so it's a preference, not a command.
    pub library_width: u32,
    /// The window's last inner size in logical px, so it reopens where the user
    /// left it. Logical so it round-trips across monitors of different scale.
    pub window_width: u32,
    pub window_height: u32,
    /// Whether the window was maximized at last close. Tracked apart from the
    /// size so un-maximizing returns to the windowed dimensions.
    pub window_maximized: bool,
    /// Download new releases in the background and offer a one-click restart.
    /// Off falls back to notifying only: the button opens the release page and
    /// nothing is ever fetched. On by default.
    pub auto_update_enabled: bool,
    /// Unix seconds of the last release check, so launches don't each spend a
    /// request against GitHub's unauthenticated rate limit.
    pub update_last_checked: u64,
    /// Version of the verified installer waiting on disk, empty when none is.
    pub update_staged_version: String,
    /// Version the app already tried to install by itself at launch: one automatic
    /// attempt each, then the button. Without it, a failing installer boot-loops.
    #[serde(default)]
    pub update_auto_applied: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            indexing_enabled: false,
            minimap_enabled: true,
            pager_enabled: true,
            speed_reader_enabled: false,
            line_numbers_enabled: false,
            reader_editing_enabled: true,
            theme_family: "fern".to_string(),
            theme_mode: "system".to_string(),
            theme_random_used: Vec::new(),
            library_view: LibraryView::default(),
            graph_scope: GraphScope::default(),
            library_project_path: String::new(),
            library_closed: false,
            library_width: 240,
            window_width: 1080,
            window_height: 820,
            window_maximized: false,
            auto_update_enabled: true,
            update_last_checked: 0,
            update_staged_version: String::new(),
            update_auto_applied: String::new(),
        }
    }
}

/// The library pane's two states: Project browses the folders one at a time (the
/// default), and Graph swaps the list for the link map. Serialized lowercase to
/// match the frontend's `LIBRARY_VIEWS` strings. The retired Tree and Flat views
/// alias to Project so an existing settings file still loads.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryView {
    #[default]
    #[serde(alias = "tree", alias = "flat")]
    Project,
    Graph,
}

impl LibraryView {
    pub fn as_str(self) -> &'static str {
        match self {
            LibraryView::Project => "project",
            LibraryView::Graph => "graph",
        }
    }

    /// Parse a value sent by the frontend, ignoring anything unrecognized. The
    /// retired `tree`/`flat` names both resolve to Project.
    pub fn from_client(value: &str) -> Option<Self> {
        match value {
            "project" | "tree" | "flat" => Some(LibraryView::Project),
            "graph" => Some(LibraryView::Graph),
            _ => None,
        }
    }
}

/// How much of the link graph the graph view draws. `Small` focuses on the open
/// document (or recents on the start screen) plus everything one link away; the
/// rest cap the densest documents at increasing sizes up to `Xl` (everything).
/// Serialized lowercase to match `GRAPH_SCOPES`. Small is the default.
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
    project_config_dir().map(|dir| dir.join("settings.json"))
}

/// Load the persisted UI toggles, falling back to defaults when the file is
/// missing or corrupt.
pub fn load_settings(settings_path: impl AsRef<Path>) -> Settings {
    let mut settings: Settings = fs::read_to_string(settings_path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default();
    // Migrate the pre-family single-axis setting: Dracula used to be a theme
    // "mode"; it's now the dark half of the Nightshade family (the renamed
    // Dracula palette).
    if settings.theme_mode == "dracula" {
        settings.theme_family = "nightshade".to_string();
        settings.theme_mode = "dark".to_string();
    }
    settings
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
