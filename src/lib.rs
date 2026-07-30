//! Core document rendering and app-state helpers for leaftext.

mod markdown;
pub mod store;
mod tei;
pub(crate) use tei::*;
mod xml;
pub(crate) use xml::*;
mod data;
pub(crate) use data::*;
mod eml;
pub(crate) use eml::*;
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
pub use assets::{bundled_asset_response, source_payload_url, BundledAsset, LOCAL_ASSET_PROTOCOL};
mod format;
pub use format::{all_document_extensions, is_supported_document_path, DocumentFormat};
mod folder_tree;
pub use folder_tree::{read_folder_listing, FolderCrumb, FolderListing};

/// Git, as much of it as a vault needs. Shells out to the machine's own git
/// rather than shipping a second one that would not know the user, their
/// identity, or how they log in to GitHub.
mod git;
pub use git::{
    create_repo_on_github, git_tooling, init_vault_repo, inspect_vault_repo, link_vault_remote,
    repo_name_for_vault, sync_vault_repo, GitError, GitTooling, SyncReport, VaultRepo,
};
mod vault_corpus;
pub use vault_corpus::{CorpusDocument, VaultCorpus, MAX_CORPUS_DOCUMENTS};
mod doc_graph;
pub use doc_graph::document_graph;
mod code_intel;
pub use code_intel::{
    corpus_note_items, document_headings, find_note, folder_note_items, folder_note_names,
    known_note_names, lint_links, note_preview, read_folder_note, HeadingItem, LintMarker,
    NoteItem,
};
mod editing;
pub use editing::{
    block_source_map, kind_is_editable, task_marker_offsets, BlockSpan, EditableDocument,
};
mod encoding;
pub use encoding::{
    decode_source, encode_source, read_source, write_source, SourceEncoding, SourceSpelling,
    SourceText,
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
    parsing::{ParseState, Scope, ScopeStack, SyntaxReference, SyntaxSet},
    util::LinesWithEndings,
};
use url::Url;

const MAX_RECENT_FILES: usize = 8;
const APP_SHELL_HTML: &str = include_str!("assets/app-shell.html");

/// The front-end script as ordered fragments, concatenated into one script sharing
/// one scope — the page has no module loader. Order is load-bearing: the last
/// fragment ends with the bootstrap call that must run after everything else.
const APP_SHELL_SCRIPT_PARTS: &[&str] = &[
    // First: the state more than one fragment touches, in scope before any of
    // them run. See the file for why it cannot live with its own subject.
    include_str!("assets/shell/state.js"),
    include_str!("assets/shell/dom.js"),
    include_str!("assets/shell/overflow.js"),
    include_str!("assets/shell/context-menu.js"),
    include_str!("assets/shell/navigation.js"),
    include_str!("assets/shell/settings.js"),
    include_str!("assets/shell/speed-reader.js"),
    include_str!("assets/shell/library.js"),
    include_str!("assets/shell/graph.js"),
    include_str!("assets/shell/graph-scene.js"),
    include_str!("assets/shell/library-search.js"),
    include_str!("assets/shell/updater.js"),
    include_str!("assets/shell/theme.js"),
    include_str!("assets/shell/render-state.js"),
    include_str!("assets/shell/code-view.js"),
    include_str!("assets/shell/code-intel.js"),
    include_str!("assets/shell/reading-blocks.js"),
    include_str!("assets/shell/dom-to-markdown.js"),
    include_str!("assets/shell/reading-edits.js"),
    include_str!("assets/shell/render-document.js"),
    include_str!("assets/shell/glossary.js"),
    include_str!("assets/shell/decorate.js"),
    include_str!("assets/shell/minimap.js"),
];

fn app_shell_script() -> &'static str {
    static SCRIPT: OnceLock<String> = OnceLock::new();
    SCRIPT.get_or_init(|| APP_SHELL_SCRIPT_PARTS.concat())
}
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
    let source = read_source(path)?;
    Ok(opened_document_from_source(&source.text, path))
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
        DocumentFormat::Eml => opened_document_from_eml(source, path),
        DocumentFormat::Markdown => opened_document_from_markdown(source, path),
    }
}

/// Load an XML document from disk and render it to an `OpenedDocument`. TEI and
/// everything else both come through here; the renderer picks by content.
pub fn load_xml_document(path: impl AsRef<Path>) -> io::Result<OpenedDocument> {
    let path = path.as_ref();
    let xml = read_source(path)?;
    Ok(opened_document_from_xml(&xml.text, path))
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

/// Render a MIME message (.eml, .mht) into an `OpenedDocument`.
pub fn opened_document_from_eml(eml: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_tree(eml, path.as_ref(), DocumentFormat::Eml, render_eml_document)
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
                // Whole-word: neither neighbor may be alphanumeric.
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

/// The shell's icon placeholders and the SVG each takes. A new icon is one row
/// here; the placeholder test proves none is left unfilled.
const APP_SHELL_ICONS: &[(&str, &str)] = &[
    ("{{LEAF_ICON_SVG}}", LEAF_ICON_SVG),
    ("{{BACK_ICON_SVG}}", BACK_ICON_SVG),
    ("{{FORWARD_ICON_SVG}}", FORWARD_ICON_SVG),
    ("{{SETTINGS_ICON_SVG}}", SETTINGS_ICON_SVG),
    ("{{OPEN_LIBRARY_ICON_SVG}}", OPEN_LIBRARY_ICON_SVG),
    ("{{OPEN_ICON_SVG}}", OPEN_ICON_SVG),
    ("{{CODE_VIEW_ICON_SVG}}", CODE_VIEW_ICON_SVG),
    ("{{DOCUMENT_ICON_SVG}}", DOCUMENT_ICON_SVG),
    ("{{SYNC_ICON_SVG}}", SYNC_ICON_SVG),
    ("{{SPEED_READER_ON_ICON_SVG}}", SPEED_READER_ON_ICON_SVG),
    ("{{SPEED_READER_OFF_ICON_SVG}}", SPEED_READER_OFF_ICON_SVG),
    ("{{LOCK_CLOSED_ICON_SVG}}", LOCK_CLOSED_ICON_SVG),
    ("{{LOCK_OPEN_ICON_SVG}}", LOCK_OPEN_ICON_SVG),
    ("{{WAND_ICON_SVG}}", WAND_ICON_SVG),
    ("{{CLOUD_ICON_SVG}}", CLOUD_ICON_SVG),
    ("{{PACKAGE_OPEN_ICON_SVG}}", PACKAGE_OPEN_ICON_SVG),
    ("{{PACKAGE_ICON_SVG}}", PACKAGE_ICON_SVG),
    ("{{FOLDER_ICON_SVG}}", FOLDER_ICON_SVG),
    ("{{GRAPH_ICON_SVG}}", GRAPH_ICON_SVG),
];

pub fn app_shell_html() -> String {
    let mut html = APP_SHELL_HTML
        .replace("{{APP_SCRIPT}}", app_shell_script())
        .replace("{{THEME_BOOTSTRAP_SCRIPT}}", &theme_bootstrap_script())
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
            "{{MONACO_SCRIPT_URL}}",
            &bundled_asset_url("monaco/monaco.js"),
        )
        .replace(
            "{{MONACO_CSS_URL}}",
            &bundled_asset_url("monaco/monaco.css"),
        );
    for (placeholder, svg) in APP_SHELL_ICONS {
        let normalized = normalize_svg_icon_colors(svg);
        html = html.replace(placeholder, normalized.trim());
    }
    html
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
    // before resetting. Appended after the families.
    items.push_str(
        &format!("<li><button type=\"button\" class=\"theme-item theme-item-random\" data-family=\"random\" aria-pressed=\"false\"><span class=\"theme-item-name\">Random</span>{THEME_ITEM_CHECK_SVG}</button></li>"),
    );
    items
}

fn theme_bootstrap_script() -> String {
    // Runs inline before first paint, so it sits beside the other web-view assets
    // rather than in a Rust literal. Both placeholders are filled from the theme
    // registry, so the family list here can never drift from the registered sources.
    const THEME_BOOTSTRAP_JS: &str = include_str!("assets/theme-bootstrap.js");

    THEME_BOOTSTRAP_JS
        .replace("{{VALID_FAMILIES}}", &theme_family_ids_json())
        .replace("{{FAMILY_FONTS}}", &theme_web_font_hrefs_json())
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

/// Read one of our own JSON config files as text.
///
/// Goes through [`read_source`] for the byte order mark: PowerShell and Notepad
/// write one by default, `serde_json` refuses a document that starts with one, and
/// every reader here falls back to defaults on a parse failure — so without this a
/// settings file someone edited by hand on Windows is silently thrown away.
///
/// Unlike a document, the spelling is dropped rather than kept. These are the
/// app's own files, rewritten whole by [`save_settings`] and [`save_recent_files`]
/// in UTF-8, and no authored text is at stake in one.
fn read_config_text(path: impl AsRef<Path>) -> io::Result<String> {
    Ok(read_source(path)?.text)
}

pub fn load_recent_files(config_path: impl AsRef<Path>) -> RecentFiles {
    let mut recent: RecentFiles = read_config_text(config_path)
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
    pub minimap_enabled: bool,
    /// Append the automatic Previous/Next pager to every document. On by default.
    pub pager_enabled: bool,
    /// Quiet prose and add bold lead anchors at word starts. Off by default.
    pub speed_reader_enabled: bool,
    /// The code view's typing help: note and heading suggestions, and the
    /// underline on links that lead nowhere. On by default.
    pub code_intel_enabled: bool,
    /// Make the reading view a live editor. On by default; off keeps it
    /// read-only. The code view edits the raw source regardless.
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
            minimap_enabled: true,
            pager_enabled: true,
            speed_reader_enabled: false,
            code_intel_enabled: true,
            theme_family: "fern".to_string(),
            theme_mode: "system".to_string(),
            theme_random_used: Vec::new(),
            graph_scope: GraphScope::default(),
            library_project_path: String::new(),
            library_closed: false,
            library_width: 240,
            window_width: 1080,
            window_height: 820,
            window_maximized: false,
            update_last_checked: 0,
            update_staged_version: String::new(),
            update_auto_applied: String::new(),
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

/// What [`load_settings`] found. An unreadable file and no file at all both end
/// in [`Settings::default()`], so without this flag the app opens factory-fresh
/// with nothing to say that someone's saved choices were skipped.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SettingsLoad {
    pub settings: Settings,
    /// A file was there and did not parse — false for the ordinary first launch.
    pub unreadable: bool,
}

/// Load the persisted UI toggles, falling back to defaults when the file is
/// missing or corrupt.
pub fn load_settings(settings_path: impl AsRef<Path>) -> SettingsLoad {
    let text = read_config_text(settings_path);
    let parsed: Option<Settings> = text
        .as_ref()
        .ok()
        .and_then(|contents| serde_json::from_str(contents).ok());
    // Read but not parsed: the file is there and we are about to ignore it.
    let unreadable = text.is_ok() && parsed.is_none();
    let mut settings = parsed.unwrap_or_default();
    // Migrate the pre-family single-axis setting: Dracula used to be a theme
    // "mode"; it's now the dark half of the Nightshade family (the renamed
    // Dracula palette).
    if settings.theme_mode == "dracula" {
        settings.theme_family = "nightshade".to_string();
        settings.theme_mode = "dark".to_string();
    }
    SettingsLoad {
        settings,
        unreadable,
    }
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
