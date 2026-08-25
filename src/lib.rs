//! Core document rendering and app-state helpers for leaftext.

/// What the render asks its host for, so the four things it reads off this machine can come from somewhere else.
mod host;
mod markdown;
pub use host::{BareHost, DesktopHost, GlossaryTerm, LeafHost, SourceSplice};
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
pub use markdown::{
    drawable_image_extensions, is_local_image_path, local_image_protocol_path,
    local_image_protocol_response, local_image_source_dir, markdown_image_insert_destination,
};
pub use theme::reading_mode_css;
pub(crate) use theme::*;
mod scripts;
pub use scripts::*;
mod pager;
pub use pager::{document_pager_html, pager_loaded_script, pager_loading_html};
mod minimap;
pub use minimap::{
    build_minimap_model, build_minimap_model_from_html, DocumentMinimap, MinimapLineCategory,
    MinimapLineStructure, MinimapSpan,
};
mod assets;
pub(crate) use assets::*;
pub use assets::{
    bundled_asset_response, source_payload_url, BundledAsset, KATEX_CSS, KATEX_FONTS,
    LOCAL_ASSET_PROTOCOL,
};
mod format;
pub use format::{all_document_extensions, is_supported_document_path, DocumentFormat};
mod folder_tree;
pub use folder_tree::{read_folder_listing, FolderCrumb, FolderListing};
mod known_folders;
pub use known_folders::{
    cloud_folders, cloud_folders_to_register, path_is_in_cloud_folder, CloudFolder, CloudRoots,
};

/// Vaults whose files are not on this machine to begin with: what a source is, and the folder the app copies one into so every reader goes on reading paths.
pub mod remote;

/// Git, as much of it as a vault needs. Shells out to the machine's own git rather than shipping a second one that would not know the user, their identity, or how they log in to GitHub.
mod git;
pub use git::{
    clone_into_vault, create_repo_on_github, failure_message, git_tooling, init_vault_repo,
    inspect_vault_repo, link_vault_remote, repo_name_for_vault, set_git_identity, sync_vault_repo,
    GitError, GitTooling, SyncReport, VaultRepo,
};
mod query;
pub use query::{
    today_or_utc, utc_today, Asks, Bound, Candidate, Compare, Condition, FieldAnswer, FieldTest,
    FieldValue, Needle, Query, TaskTally,
};
mod vault_corpus;
pub use vault_corpus::{
    folder_holds_generated_files, path_holds_generated_files, CorpusDocument, CorpusSlice,
    FilterHintField, FilterHints, VaultCorpus, CORPUS_SLICE_DOCUMENTS, MAX_CORPUS_DOCUMENTS,
};
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
    block_source_map, kind_is_editable, table_cell_replacement, table_source_map, task_entries,
    task_marker_offsets, BlockSpan, EditableDocument, TableCellMap, TableComment, TableMap,
    TableRowMap, TaskEntry,
};
mod encoding;
pub use encoding::{
    decode_source, encode_source, read_source, read_source_head, write_source, SourceEncoding,
    SourceSpelling, SourceText,
};
mod png;
pub use png::{encode_rgba, encode_rgba_paletted, rgba_from_bmp};
mod updater;
pub use updater::{
    hash_file, is_newer_version, now_unix, platform_asset_suffix, prune_staged, read_staged,
    record_apply_outcome, staging_dir, take_apply_outcome, update_check_is_due,
    update_url_is_allowed, updates_dir, windows_asset_suffix, ApplyOutcome, StagedUpdate,
    UpdateDownload, MACOS_SUFFIX, MAX_UPDATE_BYTES, UPDATE_CHECK_INTERVAL_SECS, WINDOWS_EXE_SUFFIX,
    WINDOWS_MSI_SUFFIX,
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
    html, Alignment, CodeBlockKind, CowStr, Event, HeadingLevel, LinkType, Options, Parser, Tag,
    TagEnd,
};
use serde::{Deserialize, Serialize};
#[cfg(feature = "highlight")]
use syntect::{
    parsing::{ParseState, Scope, ScopeStack, SyntaxReference, SyntaxSet},
    util::LinesWithEndings,
};
use url::Url;

/// How deep the history the start screen scrolls goes. Past what anyone scrolls, and still a file of a few KB rewritten whole on every open. Not uncapped: that is [`Favorites`]' rule on purpose — a favorite is a decision, a recent is a rolling record of what happened.
const MAX_RECENT_FILES: usize = 50;
const APP_SHELL_HTML: &str = include_str!("assets/app-shell.html");

/// The front-end script as ordered fragments, concatenated into one script sharing one scope — the page has no module loader. Order is load-bearing: the last fragment ends with the bootstrap call that must run after everything else.
const APP_SHELL_SCRIPT_PARTS: &[&str] = &[
    // The error handlers lead, so a fragment that throws as it loads is reported instead of vanishing. Nothing above them could catch it.
    include_str!("assets/shell/journal.js"),
    // Then the flowchart sheet, in seven: the grammar, the sheet that asks it, then five more of that sheet. Mermaid draws the canvas, so there is no layout of ours in between, and the grammar leads because everything else calls into it.
    include_str!("assets/shell/flow-model.js"),
    include_str!("assets/shell/flow-canvas.js"),
    // Then the rest of the sheet, all of it reaching back into the canvas, the graph and the redraw above. flow-export.js reads FLOW_SVG_NS out of flow-pointer.js, so it comes after it.
    include_str!("assets/shell/flow-pointer.js"),
    include_str!("assets/shell/flow-menu.js"),
    include_str!("assets/shell/flow-rename.js"),
    include_str!("assets/shell/flow-picker.js"),
    include_str!("assets/shell/flow-export.js"),
    // Then the state more than one fragment touches, in scope before any of them run. See the file for why it cannot live with its own subject.
    include_str!("assets/shell/state.js"),
    include_str!("assets/shell/dom.js"),
    // The first-run bubble, ahead of every fragment that registers a hint against it. It needs `send` from dom.js and nothing else.
    include_str!("assets/shell/hints.js"),
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
    include_str!("assets/shell/code-sticky.js"),
    include_str!("assets/shell/reading-blocks.js"),
    include_str!("assets/shell/dom-to-markdown.js"),
    include_str!("assets/shell/reading-edits.js"),
    // The field block at the top of a note, beside the reading view's other edit path: it needs the padlock and `send`, and reading-edits.js calls into it once a document has rendered.
    include_str!("assets/shell/frontmatter-fields.js"),
    include_str!("assets/shell/block-controls.js"),
    include_str!("assets/shell/selection-toolbar.js"),
    // Find, after both views' own code: it drives Monaco through code-view.js's editor and splices through reading-edits.js's edit path.
    include_str!("assets/shell/find-bar.js"),
    include_str!("assets/shell/render-document.js"),
    include_str!("assets/shell/glossary.js"),
    // Generated from design/icons.md, and data only: the icon set the next fragment hands to mermaid so `A@{ icon: "leaf:back" }` draws the app's own drawing rather than mermaid's off-theme blue square.
    include_str!("assets/mermaid-icons.js"),
    // Every color a diagram is drawn in, before the file that draws one: decorate.js calls its runtime config and nothing in it reaches back.
    include_str!("assets/shell/mermaid-theme.js"),
    include_str!("assets/shell/decorate.js"),
    include_str!("assets/shell/table-sheet.js"),
    // Beside it: the same surface pointed at a picture, and after decorate.js because the paragraph it hangs an opener on is the one decorate.js marks.
    include_str!("assets/shell/image-sheet.js"),
    // After decorate.js: the full-window diagram borrows its zoom group builder and its delegated pan, wheel and click.
    include_str!("assets/shell/diagram-view.js"),
    include_str!("assets/shell/minimap.js"),
];

/// The whole front-end, joined and served as `app.js` over the asset protocol.
///
/// The page goes to WebView2 as one string with a ~2 MB ceiling, and the script was 505,232 of its 576,693 characters. Served instead, the page is a skeleton — and because no fragment carries a placeholder, this is a join and nothing else: no substitution pass, and one file on the wire rather than two.
pub fn app_shell_script() -> &'static str {
    static SCRIPT: OnceLock<String> = OnceLock::new();
    SCRIPT.get_or_init(|| APP_SHELL_SCRIPT_PARTS.concat())
}
pub const LOCAL_IMAGE_PROTOCOL: &str = "leaf-image";
const LOCAL_IMAGE_HOST: &str = "local";
const LOCAL_IMAGE_PARENT_SEGMENT: &str = "__leaf_parent__";
/// Marks a `leaf-image://` URL carrying a whole absolute path, for an image that does not sit under the open document's folder.
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
    /// Source format, so the reading view knows how to anchor edits. Markdown blocks carry ranges in `blocks` (positional on the DOM); the tree formats carry `data-src-*` inline in `html`.
    pub format: DocumentFormat,
    /// Top-level block source ranges in document order, for in-viewer editing. Markdown only; the tree formats stamp ranges inline on the HTML.
    #[serde(default)]
    pub blocks: Vec<BlockSpan>,
    /// Source byte offset of each list task marker's state char, in document order (see [`task_marker_offsets`]). Markdown only.
    #[serde(default)]
    pub tasks: Vec<usize>,
    /// The raw source the block ranges index into. Sent for the tree formats (TEI and a data file can't be reconstructed from the HTML); empty for Markdown, which round-trips from the DOM.
    #[serde(default)]
    pub source: String,
    /// Which renderer inside the format drew it, where the format has more than one: `"tei"` for a TEI document, `None` for every other. The reading view offers a reader the elements that renderer draws, so the routing has to reach the page rather than be guessed there.
    #[serde(default)]
    pub dialect: Option<&'static str>,
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

    /// Drop `path` from the list (e.g. it no longer exists, so it should stop being offered). Returns whether it was present.
    pub fn forget(&mut self, path: &Path) -> bool {
        let path = normalize_recent_path(path);
        let before = self.files.len();
        self.files.retain(|existing| existing != &path);
        before != self.files.len()
    }

    /// Collapse entries to normalized form, dropping duplicates in order. Run on load so the same file recorded under different spellings self-heals.
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

/// What a favorite points at. A folder can be favorited too, so a shortcut to one is the same store rather than a second list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FavoriteKind {
    Document,
    Folder,
}

/// One favorite, with the vault it was marked inside. `vault_id` is `None` for something outside every vault — drawn in its own group rather than refused, since a file on the desktop is still a file you can favorite.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    #[serde(default)]
    pub vault_id: Option<i64>,
    pub path: PathBuf,
    pub kind: FavoriteKind,
}

/// The favorites, in the order the user put them in. Unlike [`RecentFiles`] there is no cap and nothing but the user takes an entry out: a recent is a record of what happened, and this is a decision somebody made.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Favorites {
    pub entries: Vec<Favorite>,
}

impl Favorites {
    /// Favorite `favorite`, at the end of the list. Returns whether it was added; marking something twice is not an error and never moves it.
    pub fn add(&mut self, favorite: Favorite) -> bool {
        let favorite = Favorite {
            path: normalize_recent_path(&favorite.path),
            ..favorite
        };
        if self.entries.iter().any(|one| one.path == favorite.path) {
            return false;
        }
        self.entries.push(favorite);
        true
    }

    /// Unfavorite `path`. Returns whether it was there, so the save is skipped when nothing changed.
    pub fn remove(&mut self, path: &Path) -> bool {
        let path = normalize_recent_path(path);
        let before = self.entries.len();
        self.entries.retain(|one| one.path != path);
        before != self.entries.len()
    }

    pub fn contains(&self, path: &Path) -> bool {
        let path = normalize_recent_path(path);
        self.entries.iter().any(|one| one.path == path)
    }

    /// Move the entry at `from` so it sits at `to`. An index the list does not have changes nothing, so a drop the page mis-measured cannot scramble the order.
    pub fn reorder(&mut self, from: usize, to: usize) -> bool {
        if from == to || from >= self.entries.len() || to >= self.entries.len() {
            return false;
        }
        let entry = self.entries.remove(from);
        self.entries.insert(to, entry);
        true
    }

    /// Point the favorite at `from` at `to`, keeping its place in the list. Returns whether `from` was there — a path the list does not hold changes nothing, so an answer about a row that has since been unfavorited cannot put one back. `remove` then `add` would land it at the end instead, which loses the order the user set. The vault is the registry's answer about the new path, not the old entry's: a file that really moved to another vault belongs to that vault's group.
    pub fn repoint(&mut self, from: &Path, to: &Path, vault_id: Option<i64>) -> bool {
        let from = normalize_recent_path(from);
        let to = normalize_recent_path(to);
        let Some(at) = self.entries.iter().position(|one| one.path == from) else {
            return false;
        };
        // Already a favorite somewhere else in the list: repointing here would hold one path twice, so the repaired row goes and the entry that was already there keeps its own place.
        if self
            .entries
            .iter()
            .enumerate()
            .any(|(index, one)| index != at && one.path == to)
        {
            self.entries.remove(at);
            return true;
        }
        self.entries[at].path = to;
        self.entries[at].vault_id = vault_id;
        true
    }

    /// Move the favorite at `path` so it sits directly before the one at `before`, or last when there is none. Paths rather than positions, because the list the page draws is grouped by vault and can still be drawing a row that has left the store — so a drawn index is not one of these. Either path being absent changes nothing.
    pub fn move_before(&mut self, path: &Path, before: Option<&Path>) -> bool {
        let path = normalize_recent_path(path);
        let Some(from) = self.entries.iter().position(|one| one.path == path) else {
            return false;
        };
        let to = match before {
            Some(before) => {
                let before = normalize_recent_path(before);
                let Some(at) = self.entries.iter().position(|one| one.path == before) else {
                    return false;
                };
                // Landing before a row further down: taking this one out first shifts that row up by one, and inserting at its old index would drop this one after it.
                if from < at {
                    at - 1
                } else {
                    at
                }
            }
            None => self.entries.len() - 1,
        };
        self.reorder(from, to)
    }

    /// Unfavorite everything marked inside `vault_id`, for a vault being removed. The registry is the only record of what that id meant, so keeping them would leave paths nobody can name.
    pub fn forget_vault(&mut self, vault_id: i64) -> bool {
        let before = self.entries.len();
        self.entries.retain(|one| one.vault_id != Some(vault_id));
        before != self.entries.len()
    }

    /// Collapse entries to normalized form, dropping duplicates in order. Run on load, like Recent's, so the same path favorited under two spellings self-heals.
    fn normalize_entries(&mut self) {
        let mut normalized: Vec<Favorite> = Vec::with_capacity(self.entries.len());
        for entry in self.entries.drain(..) {
            let entry = Favorite {
                path: normalize_recent_path(&entry.path),
                ..entry
            };
            if !normalized.iter().any(|one| one.path == entry.path) {
                normalized.push(entry);
            }
        }
        self.entries = normalized;
    }
}

/// Resolve `.` and `..` in `path` lexically (not via the filesystem) so two spellings of the same file collapse to one entry in Recent or in the favorites. Lexical rather than canonicalized keeps the path human-readable (no `\\?\` prefix) and usable by OS file-reveal commands.
fn normalize_recent_path(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            // Only pop a real segment; a `..` that escapes the root can't be resolved lexically, so keep it verbatim.
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

/// What a tab is called: the file's own name without its suffix, never the document's heading — a tab strip is a list of files, and two notes titled the same are still two files.
pub fn tab_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string())
}

/// Render source already in hand, picking the renderer by the path's format: the counterpart to [`load_document`] for live reload's hash-gated bytes and the code view's unsaved edits. The one routing table, because a second one drifts.
pub fn opened_document_from_source(source: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_source_with_host(source, path.as_ref(), &DesktopHost::default())
}

/// The same routing table, told who answers the four things a render cannot get from the text. Every entry point above it is this one with [`DesktopHost`].
pub fn opened_document_from_source_with_host(
    source: &str,
    path: impl AsRef<Path>,
    host: &dyn LeafHost,
) -> OpenedDocument {
    let path = path.as_ref();
    match DocumentFormat::from_path(path) {
        DocumentFormat::Xml => opened_document_from_xml_with_host(source, path, host),
        DocumentFormat::Json => opened_document_from_tree(
            source,
            path,
            DocumentFormat::Json,
            render_json_document,
            host,
        ),
        DocumentFormat::Yaml => opened_document_from_tree(
            source,
            path,
            DocumentFormat::Yaml,
            render_yaml_document,
            host,
        ),
        DocumentFormat::Eml => {
            opened_document_from_tree(source, path, DocumentFormat::Eml, render_eml_document, host)
        }
        DocumentFormat::Markdown => opened_document_from_markdown_with_host(source, path, host),
    }
}

/// Load an XML document from disk and render it to an `OpenedDocument`. TEI and everything else both come through here; the renderer picks by content.
pub fn load_xml_document(path: impl AsRef<Path>) -> io::Result<OpenedDocument> {
    let path = path.as_ref();
    let xml = read_source(path)?;
    Ok(opened_document_from_xml(&xml.text, path))
}

/// Render an XML string into an `OpenedDocument`: TEI through the TEI renderer, any other XML through the generic one.
pub fn opened_document_from_xml(xml: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_xml_with_host(xml, path.as_ref(), &DesktopHost::default())
}

/// The same render, told who answers for it. The dialect comes back out of the render because the renderer is what picks it; deciding it here would mean parsing the document a second time to ask a question it has already answered.
fn opened_document_from_xml_with_host(
    xml: &str,
    path: &Path,
    host: &dyn LeafHost,
) -> OpenedDocument {
    let dialect = std::cell::Cell::new(None);
    let mut document = opened_document_from_tree(
        xml,
        path,
        DocumentFormat::Xml,
        |source, fallback_title| {
            let (title, html, blocks, drawn_by) = render_xml_document(source, fallback_title);
            dialect.set(drawn_by);
            (title, html, blocks)
        },
        host,
    );
    document.dialect = dialect.get();
    document
}

/// Render a JSON string into an `OpenedDocument`.
pub fn opened_document_from_json(json: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_tree(
        json,
        path.as_ref(),
        DocumentFormat::Json,
        render_json_document,
        &DesktopHost::default(),
    )
}

/// Render a YAML string into an `OpenedDocument`.
pub fn opened_document_from_yaml(yaml: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_tree(
        yaml,
        path.as_ref(),
        DocumentFormat::Yaml,
        render_yaml_document,
        &DesktopHost::default(),
    )
}

/// Render a MIME message (.eml, .mht) into an `OpenedDocument`.
pub fn opened_document_from_eml(eml: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_tree(
        eml,
        path.as_ref(),
        DocumentFormat::Eml,
        render_eml_document,
        &DesktopHost::default(),
    )
}

/// The mark a tree renderer puts on the page's heading where it took the words from the file's name rather than from anything the document says. A fact about the document, stated wherever it is drawn — the invitation to rename it is the app shell's alone, since a published site cannot rename anything.
pub(crate) const BORROWED_TITLE_ATTR: &str = " data-borrowed-title";

/// Render a document that is a tree rather than prose — every format but Markdown — into an `OpenedDocument`. They differ only in the reader that turns source into HTML; the shell around it is the same, and none of them can be reconstructed from the DOM, so each sends its `source` along.
fn opened_document_from_tree(
    source: &str,
    path: &Path,
    format: DocumentFormat,
    render: impl Fn(&str, Option<&str>) -> (Option<String>, String, Vec<BlockSpan>),
    host: &dyn LeafHost,
) -> OpenedDocument {
    let render_path = host.resolve_path(path);

    // A document with no title of its own is titled by its file name, which the renderer also heads the page with (a sitemap, or a lock file, has nowhere else to say what it is).
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
        .and_then(file_url_for_directory)
        .map(|url| format!(r#"<base href="{}">"#, encode_text(url.as_str())))
        .unwrap_or_default();

    // Optionally auto-link glossary terms from GLOSSARY.md next to the doc.
    let body_html = match render_path.parent() {
        Some(dir) => auto_link_glossary(body_html, dir, host),
        None => body_html,
    };

    // Chart the rendered block HTML (there is no Markdown source to line-scan), before wrapping in the <article>/pager shell so the scan sees only content.
    let minimap = build_minimap_model_from_html(&body_html);

    let article = format!(
        r#"{base_href}<article class="document-body">{body_html}{}</article>"#,
        host.pager_placeholder().unwrap_or_default()
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
        dialect: None,
    }
}

/// Render an already-loaded markdown string into an `OpenedDocument`. Split out from [`load_document`] so live-reload can read the file once and reuse the string rather than reading twice.
pub fn opened_document_from_markdown(markdown: &str, path: impl AsRef<Path>) -> OpenedDocument {
    opened_document_from_markdown_with_host(markdown, path.as_ref(), &DesktopHost::default())
}

/// The same render, told who answers for it.
pub fn opened_document_from_markdown_with_host(
    markdown: &str,
    path: impl AsRef<Path>,
    host: &dyn LeafHost,
) -> OpenedDocument {
    let path = path.as_ref();
    let render_path = host.resolve_path(path);
    let rendered = render_markdown_document_with_host(markdown, &render_path, host);

    // A waiting state only where something is coming: the real Previous/Next strip scans the folder tree after the document is on screen.
    let html = match (
        host.pager_placeholder(),
        rendered.html.strip_suffix("</article>"),
    ) {
        (Some(waiting), Some(body)) => format!("{body}{waiting}</article>"),
        _ => rendered.html,
    };

    OpenedDocument {
        title: rendered.title,
        path: path.display().to_string(),
        html,
        minimap: build_minimap_model(markdown),
        format: DocumentFormat::Markdown,
        blocks: block_source_map(markdown),
        tasks: task_marker_offsets(markdown),
        // Lets blocks that don't round-trip from the DOM (lists, tables, code, images, footnotes) edit their exact source; text blocks ignore it.
        source: markdown.to_string(),
        dialect: None,
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
    render_markdown_document_with_host(markdown, source_path.as_ref(), &DesktopHost::default())
}

/// The Markdown render, told who answers the four things it cannot get from the text: the vault's field types, the repository a `#123` points at, an image's own size, and the nearest glossary. A host that answers none of them renders the document without those four decorations.
pub fn render_markdown_document_with_host(
    markdown: &str,
    source_path: impl AsRef<Path>,
    host: &dyn LeafHost,
) -> RenderedDocument {
    let source_path = source_path.as_ref();
    // Detect the title past any leading frontmatter, so the tab title is the document's real heading, not the `---` metadata.
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
        host,
    });
    // Auto-link glossary terms from the nearest GLOSSARY.md (occurrences already inside a link or code are left alone). Skip the glossary file itself.
    let is_glossary = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("GLOSSARY.md"))
        .unwrap_or(false);
    let body = match (is_glossary, source_path.parent()) {
        (false, Some(dir)) => auto_link_glossary(body, dir, host),
        _ => body,
    };
    let base_href = source_path
        .parent()
        .and_then(file_url_for_directory)
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

/// Parse `## Term` lines from a GLOSSARY.md into `(term, slug)` pairs, sorted longest-first so multi-word terms match before their substrings.
fn parse_glossary_terms(path: &Path) -> Vec<(String, String)> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    glossary_terms_in(&content)
        .into_iter()
        .map(|term| (term.term, term.slug))
        .collect()
}

/// The same reading, over text rather than a file, so a host with no disk can hand a glossary over — see [`LeafHost::glossary_terms`].
pub fn glossary_terms_in(content: &str) -> Vec<GlossaryTerm> {
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
        .into_iter()
        .map(|(term, slug)| GlossaryTerm { term, slug })
        .collect()
}

/// Walk the HTML body string and wrap term occurrences in glossary links, skipping text inside `<a>`, `<code>`, or `<pre>` elements. Matches are whole-word (Unicode letter/digit boundaries) and case-insensitive.
fn link_terms_in_html(html: &str, terms: &[(String, String)]) -> String {
    if terms.is_empty() {
        return html.to_string();
    }

    // Precompute lowercased term + slug once (not per run), longest-first, and bucket by lowercased first byte so each scan position tests only the few terms that could start there.
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

/// Replace term occurrences with `<a href="glossary:slug">term</a>` in a plain text run. Matching runs against a lowercased copy of `text`, with every offset mapped back through `orig` to a real char boundary — `to_lowercase()` can change byte length, so indexing the original with lowercased offsets would panic on the diacritics these documents are full of.
fn replace_terms_in_text(
    text: &str,
    prepared: &[(String, String)],
    buckets: &HashMap<u8, Vec<usize>>,
) -> String {
    // `orig[i]` is the original byte offset lowercased byte `i` came from, with a trailing sentinel, so any offset in `0..=lower.len()` maps to a valid char boundary in `text`.
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

/// Find the nearest `GLOSSARY.md` by walking up from `doc_dir` to the root (the glossary usually sits at a project root well above the document). Each folder is read and the name compared ignoring case, the way `pager::readme_in` finds a `README.md`, so `Glossary.md` counts on a disk that tells the spellings apart and the path handed back carries the file's own name. The glossary sheet takes this too, so nothing can disagree about which file is the glossary.
pub fn nearest_glossary_file(doc_dir: &Path) -> Option<PathBuf> {
    let mut dir = Some(doc_dir);
    while let Some(folder) = dir {
        let found = fs::read_dir(folder).ok().and_then(|entries| {
            entries.flatten().find_map(|entry| {
                let name = entry.file_name();
                let name = name.to_str()?;
                name.eq_ignore_ascii_case("GLOSSARY.md")
                    .then(|| entry.path())
            })
        });
        if let Some(found) = found.filter(|path| path.is_file()) {
            return Some(found);
        }
        dir = folder.parent();
    }
    None
}

/// Find the nearest GLOSSARY.md at or above `doc_dir` and auto-link its terms in `body_html`.
fn auto_link_glossary(body_html: String, doc_dir: &Path, host: &dyn LeafHost) -> String {
    let terms: Vec<(String, String)> = host
        .glossary_terms(doc_dir)
        .into_iter()
        .map(|term| (term.term, term.slug))
        .collect();
    if terms.is_empty() {
        return body_html;
    }
    link_terms_in_html(&body_html, &terms)
}

/// The nearest glossary's terms, which is what [`DesktopHost`] answers with. Longest first, so a multi-word term matches before its own substring.
pub(crate) fn nearest_glossary_terms(doc_dir: &Path) -> Vec<GlossaryTerm> {
    let Some(glossary_path) = nearest_glossary_file(doc_dir) else {
        return Vec::new();
    };
    parse_glossary_terms(&glossary_path)
        .into_iter()
        .map(|(term, slug)| GlossaryTerm { term, slug })
        .collect()
}

/// The page, with the five things only the host knows filled in: the script, the theme bootstrap, the theme picker's cards, and two asset URLs whose scheme is the platform's to choose. No icon is substituted — every one is a class in `icons.css`, so the drawings are served with the stylesheet instead of pasted into this string.
pub fn app_shell_html() -> String {
    app_shell_html_for_host(&DesktopHost::default())
}

/// The same page, with the asset URLs the host chooses. A browser serves them over http; the desktop over its own protocol.
pub fn app_shell_html_for_host(host: &dyn LeafHost) -> String {
    let asset = |name: &str| host.asset_url(name).unwrap_or_default();
    APP_SHELL_HTML
        .replace("{{APP_SCRIPT_URL}}", &asset("app.js"))
        .replace(
            "{{THEME_BOOTSTRAP_SCRIPT}}",
            &theme_bootstrap_script_for_host(host),
        )
        .replace("{{APP_CSS_URL}}", &asset("app.css"))
        .replace("{{THEME_ITEMS}}", &theme_items_html())
        .replace("{{KATEX_CSS_URL}}", &asset("katex/katex.min.css"))
}

/// The document as a page of its own: what a reader hands to somebody who does not have Leaftext.
///
/// `markup` is the document as the page has already drawn it, cleaned of the app's own controls and wrapped in the ancestors every rule in the stylesheet is keyed on — the page builds that chain, because the page is what knows which of its own elements are controls. Nothing here is fetched: a drawn diagram is already an SVG in that markup, an icon is a mask inside the stylesheet, and ordinary text takes the reader's own system font. One thing runs, off the folder beside the page — the minimap rail, which is the only way a reader handed this file can see the shape of the whole document.
///
/// `sheet` is the drawings' own stylesheet. Mermaid writes one per drawing and the page hoists them into a single element in its head, so the rules are neither in the stylesheet nor inside the SVG — a copy of the document alone comes out a page of black boxes with clipped labels. It travels inline rather than as a second file because it is markup the page already holds as one string.
///
/// `theme` and `appearance` are the two attributes every theme's colors are keyed on, so the page opens in the theme it was written from with no script at all.
pub fn exported_page_document(
    theme: &str,
    appearance: &str,
    title: &str,
    sheet: &str,
    markup: &str,
) -> String {
    let title = match title.trim() {
        "" => "Document",
        named => named,
    };
    let sheet = match sheet.trim() {
        "" => String::new(),
        rules => format!(
            "<style id=\"{MERMAID_SHEET_ELEMENT_ID}\">
{rules}
</style>
"
        ),
    };
    // Named only where there is an equation to spend it on: it is 283,127 bytes with its faces, and nobody else should carry them.
    let math = match markup_has_math(markup) {
        true => format!("<link rel=\"stylesheet\" href=\"{EXPORTED_PAGE_MATH_STYLESHEET}\">\n"),
        false => String::new(),
    };
    format!(
        "<!DOCTYPE html>
<html lang=\"en\" data-leaf-theme=\"{theme}\" data-leaf-appearance=\"{appearance}\">
<head>
<meta charset=\"utf-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
<title>{title}</title>
<link rel=\"stylesheet\" href=\"{EXPORTED_PAGE_STYLESHEET}\">
<script src=\"{EXPORTED_PAGE_MINIMAP_SCRIPT}\" defer></script>
{math}{sheet}</head>
<body class=\"leaf-paper leaf-web\">
{markup}
</body>
</html>
",
        theme = escape_html_text(theme),
        appearance = escape_html_text(appearance),
        title = escape_html_text(title),
    )
}

/// Where an exported page's stylesheet goes, and the folder every picture beside it goes in. The same `assets` folder the static site export already writes, so a reader who has seen one knows the other.
pub const EXPORTED_PAGE_ASSETS_FOLDER: &str = "assets";

/// The one stylesheet an exported page names: the whole of [`reading_mode_css`], which carries every theme's colors, the tokens, the icons and the reading rules. All of it rather than a trimmed copy — deciding which rules a document needs is a guess against a stylesheet that changes every week, and a rule missed is a page that looks wrong in a way nobody can see coming.
pub const EXPORTED_PAGE_STYLESHEET: &str = "assets/app.css";

/// The one script an exported page names: the minimap rail, in the `assets` folder beside the stylesheet.
pub const EXPORTED_PAGE_MINIMAP_SCRIPT: &str = "assets/minimap.js";

/// That script's text: the minimap both published sites run, respelled so it loads off a disk.
///
/// Two changes and no more. The `export` mark comes off, because a browser refuses a module script on a page opened off a disk and opened off a disk is what an exported page is — watched as a rail that never appeared at all. And one call goes on the foot, since nothing on this page imports anything to make it. Respelled here rather than kept as a second copy in the tree, so the rail's arithmetic has one source.
pub fn exported_page_minimap_script() -> String {
    format!(
        "{}
initMinimap(document.querySelector('.document-body'));
",
        SITE_MINIMAP_JS.replacen(
            "
export function initMinimap",
            "
function initMinimap",
            1
        )
    )
}

/// Whether a document has math drawn in it.
///
/// The app draws every equation in the page rather than at render time, and KaTeX wraps each one in an element of its own — so this is the one mark saying the math stylesheet has work to do here. Watched in a real browser: without that stylesheet an equation prints twice on one line, because KaTeX renders two copies of itself and the sheet is what hides one of them.
pub fn markup_has_math(markup: &str) -> bool {
    markup.contains("class=\"katex")
}

/// The math stylesheet an exported page names, where it has math in it. A file of its own rather than part of the one above, because that one is compiled here and this is a vendored stylesheet addressing its own faces.
pub const EXPORTED_PAGE_MATH_STYLESHEET: &str = "assets/katex.min.css";

/// Where the faces that stylesheet asks for go. The folder name is the stylesheet's own — it addresses them as `fonts/…` beside itself — so this is that address read from the folder the page sits in.
pub const EXPORTED_PAGE_MATH_FONTS_FOLDER: &str = "assets/fonts";

/// Where one picture sits in an exported page: the `assets` folder beside it, under the name the copy was written as. Percent-encoded, because a picture on disk may be called anything a filesystem permits and the page addresses it as a URL.
pub fn exported_picture_url(name: &str) -> String {
    format!(
        "{EXPORTED_PAGE_ASSETS_FOLDER}/{}",
        percent_encode_url_path_segment(name)
    )
}

/// What the page calls the element it hoists every drawing's stylesheet into. Written here and read in `decorate.js`.
const MERMAID_SHEET_ELEMENT_ID: &str = "leaf-mermaid-sheets";

/// Text going into an attribute or between tags. Four characters, because that is all an attribute this app writes can carry — the values are a theme name, an appearance and a document title.
fn escape_html_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Selected-state check badge shown on the active theme card (Heroicons check-circle, stroked in the accent color via `currentColor`). Hidden until the card is `.is-active`.
const THEME_ITEM_CHECK_SVG: &str =
    "<span class=\"lt-icon theme-item-check lt-icon-check-circle\"></span>";

/// The tokens each card previews as a swatch strip: paper, ink, brand, then two code accents — the colors that make one theme look unlike another.
const THEME_SWATCH_TOKENS: &[&str] = &[
    "--lt-background",
    "--lt-foreground",
    "--lt-primary",
    "--lt-syntax-keyword",
    "--lt-syntax-string",
];

/// Spinner shown over a card while the picker loads that theme's web font. The shell adds `.is-loading` on open and clears it once the font is ready.
const THEME_ITEM_SPINNER: &str =
    "<span class=\"lt-spinner theme-item-spinner\" aria-hidden=\"true\"></span>";

/// The card wears the theme's own paper, ink and heading font, per appearance, so it reads as a swatch of the theme itself. `--card-font` is applied only once the shell has loaded that font (`.font-ready`); until then the card keeps the app font. Random has none of these, so it starts on the neutral tile.
fn theme_card_style(family: &str) -> String {
    let pick = |appearance: Appearance, token: &str| {
        theme_sources()
            .iter()
            .find(|s| s.family == family && s.appearance == appearance)
            .and_then(|s| theme_source_token_value(s, token))
            .unwrap_or("#808080")
    };
    let font = theme_sources()
        .iter()
        .find(|s| s.family == family)
        .map(|s| s.font_heading)
        .unwrap_or("");
    // The style attribute is double-quoted, but font stacks quote their names; encode those inner quotes so the attribute stays well-formed.
    let font = font.replace('"', "&quot;");
    format!(
        "--card-bg-light:{};--card-bg-dark:{};--card-fg-light:{};--card-fg-dark:{};--card-font:{font}",
        pick(Appearance::Light, "--lt-background"),
        pick(Appearance::Dark, "--lt-background"),
        pick(Appearance::Light, "--lt-foreground"),
        pick(Appearance::Dark, "--lt-foreground"),
    )
}

/// One swatch strip for a family: each swatch carries its light and dark color, and the card shows whichever matches the resolved appearance (CSS picks).
fn theme_swatches_html(family: &str) -> String {
    let sources = theme_sources();
    let source = |appearance: Appearance| {
        sources
            .iter()
            .find(|s| s.family == family && s.appearance == appearance)
    };
    let light = source(Appearance::Light);
    let dark = source(Appearance::Dark);
    let mut swatches = String::new();
    for token in THEME_SWATCH_TOKENS {
        let value = |src: Option<&ThemeSource>| {
            src.and_then(|s| theme_source_token_value(s, token))
                .unwrap_or("#808080")
        };
        let (l, d) = (value(light), value(dark));
        swatches.push_str(&format!(
            "<span class=\"theme-swatch\" style=\"--sw-light:{l};--sw-dark:{d}\"></span>"
        ));
    }
    format!("<span class=\"theme-swatches\" aria-hidden=\"true\">{swatches}</span>")
}

fn theme_items_html() -> String {
    let mut items: String = theme_families()
        .into_iter()
        .map(|(id, name)| {
            let swatches = theme_swatches_html(id);
            let style = theme_card_style(id);
            format!(
                "<li><button type=\"button\" class=\"theme-item\" data-family=\"{id}\" style=\"{style}\" aria-pressed=\"false\"><span class=\"theme-item-name\">{name}</span>{swatches}{THEME_ITEM_SPINNER}{THEME_ITEM_CHECK_SVG}</button></li>"
            )
        })
        .collect();
    // "Random" is not a real family: it's a preference the bootstrap resolves to a concrete family at each launch, cycling through every family without repeat before resetting. Appended after the families, and seeded with the first family's look — the shell then cycles it through every theme while the sheet is open, the name alone staying "Random".
    let seed = theme_families().first().map(|(id, _)| *id).unwrap_or("");
    let random_swatches = theme_swatches_html(seed);
    let random_style = theme_card_style(seed);
    items.push_str(
        &format!("<li><button type=\"button\" class=\"theme-item theme-item-random\" data-family=\"random\" style=\"{random_style}\" aria-pressed=\"false\"><span class=\"theme-item-name\">Random</span>{random_swatches}{THEME_ITEM_SPINNER}{THEME_ITEM_CHECK_SVG}</button></li>"),
    );
    items
}

/// The bootstrap, with the vendored runtimes' URLs the host chooses: their spelling is the host's, and a browser serves them over http where the desktop serves its own protocol.
fn theme_bootstrap_script_for_host(host: &dyn LeafHost) -> String {
    // Runs inline before first paint, so it sits beside the other web-view assets rather than in a Rust literal. Both placeholders are filled from the theme registry, so the family list here can never drift from the registered sources.
    const THEME_BOOTSTRAP_JS: &str = include_str!("assets/theme-bootstrap.js");

    THEME_BOOTSTRAP_JS
        .replace("{{VALID_FAMILIES}}", &theme_family_ids_json())
        .replace("{{FAMILY_FONTS}}", &theme_web_font_hrefs_json())
        .replace("{{ASSET_URLS}}", &vendored_asset_urls_json_for_host(host))
}

/// The vendored runtimes' URLs, as one JSON object for `window.__lt.assets`. Each is a `leaf-asset://` URL whose spelling depends on the platform, so the page cannot hold them as literals — and a fragment that held one could not be served as a file.
fn vendored_asset_urls_json_for_host(host: &dyn LeafHost) -> String {
    let entries = [
        ("mermaid", "mermaid.min.js"),
        ("katex", "katex/katex.min.js"),
        ("pixi", "pixi.min.js"),
        ("pixiUnsafeEval", "pixi-unsafe-eval.min.js"),
        ("d3Force", "d3-force.min.js"),
        ("monaco", "monaco/monaco.js"),
        ("monacoCss", "monaco/monaco.css"),
    ];
    let pairs: Vec<String> = entries
        .iter()
        .map(|(key, asset)| {
            format!(
                "\"{key}\":\"{}\"",
                host.asset_url(asset).unwrap_or_default()
            )
        })
        .collect();
    format!("{{{}}}", pairs.join(","))
}

/// Reverse-DNS app id, and the two halves it is built from. macOS names the per-app folder with the whole id; Windows nests organization inside application. Both spellings are load-bearing: they are where every existing install already keeps its settings, recent files, and vault registry. Only macOS spells the qualifier into a path; Windows ignores it entirely.
#[cfg(target_os = "macos")]
const APP_QUALIFIER: &str = "com";
#[cfg(feature = "desktop")]
const APP_ORGANIZATION: &str = "ryanallen";
#[cfg(feature = "desktop")]
const APP_NAME: &str = "leaftext";

/// Roaming per-user configuration root: settings and recent files.
#[cfg(feature = "desktop")]
pub fn project_config_dir() -> Option<PathBuf> {
    installed_config_dir()
}

/// Where an installed copy keeps its settings and recent files.
///
/// Windows: `%APPDATA%\ryanallen\leaftext\config`. macOS: `~/Library/Application Support/com.ryanallen.leaftext`.
///
/// These reproduce, exactly, the layout the `directories` crate produced for `ProjectDirs::from("com", "ryanallen", "leaftext")` — including the `config` leaf on Windows, which is easy to miss and would strand every existing user's settings if it were dropped. `project_dirs_match_the_documented_layout` pins both.
#[cfg(feature = "desktop")]
pub(crate) fn installed_config_dir() -> Option<PathBuf> {
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

/// Machine-local per-user data root: WebView2's cache, the vault registry, staged updates and the journal.
#[cfg(feature = "desktop")]
pub fn project_data_local_dir() -> Option<PathBuf> {
    installed_data_local_dir()
}

/// Where an installed copy keeps that data.
///
/// Windows: `%LOCALAPPDATA%\ryanallen\leaftext\data`. macOS: `~/Library/Application Support/com.ryanallen.leaftext`, which is the same folder as the config root — the platform draws no roaming distinction.
#[cfg(feature = "desktop")]
pub(crate) fn installed_data_local_dir() -> Option<PathBuf> {
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
pub(crate) fn macos_application_support_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").filter(|home| !home.is_empty())?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(format!("{APP_QUALIFIER}.{APP_ORGANIZATION}.{APP_NAME}")),
    )
}

#[cfg(feature = "desktop")]
pub fn config_file_path() -> Option<PathBuf> {
    project_config_dir().map(|dir| dir.join("recent-files.json"))
}

#[cfg(feature = "desktop")]
pub fn webview_user_data_dir() -> Option<PathBuf> {
    project_data_local_dir().map(|dir| dir.join("webview2"))
}

/// The app data root for leaftext's own files: `manifest.db` (the vault registry) and staged updates. The local data dir itself, not the WebView2 cache subfolder, so neither is entangled with the browser's storage.
#[cfg(feature = "desktop")]
pub fn app_data_dir() -> Option<PathBuf> {
    project_data_local_dir()
}

/// Read one of our own JSON config files as text.
///
/// Goes through [`read_source`] for the byte order mark: PowerShell and Notepad write one by default, `serde_json` refuses a document that starts with one, and every reader here falls back to defaults on a parse failure — so without this a settings file someone edited by hand on Windows is silently thrown away.
///
/// Unlike a document, the spelling is dropped rather than kept. These are the app's own files, rewritten whole by [`save_settings`] and [`save_recent_files`] in UTF-8, and no authored text is at stake in one.
fn read_config_text(path: impl AsRef<Path>) -> io::Result<String> {
    Ok(read_source(path)?.text)
}

/// Both lists in the config file. They share one file, so each save reads what is on disk and replaces only its own half; a file written before favorites existed loads with an empty one.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct ConfigLists {
    files: Vec<PathBuf>,
    favorites: Favorites,
}

fn read_config_lists(config_path: impl AsRef<Path>) -> ConfigLists {
    read_config_text(config_path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn write_config_lists(config_path: impl AsRef<Path>, lists: &ConfigLists) -> io::Result<()> {
    let config_path = config_path.as_ref();
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(lists)?;
    fs::write(config_path, json)
}

pub fn load_recent_files(config_path: impl AsRef<Path>) -> RecentFiles {
    let mut recent = RecentFiles {
        files: read_config_lists(config_path).files,
    };
    recent.normalize_entries();
    recent
}

pub fn save_recent_files(config_path: impl AsRef<Path>, recent: &RecentFiles) -> io::Result<()> {
    let mut lists = read_config_lists(&config_path);
    lists.files.clone_from(&recent.files);
    write_config_lists(config_path, &lists)
}

pub fn load_favorites(config_path: impl AsRef<Path>) -> Favorites {
    let mut favorites = read_config_lists(config_path).favorites;
    favorites.normalize_entries();
    favorites
}

pub fn save_favorites(config_path: impl AsRef<Path>, favorites: &Favorites) -> io::Result<()> {
    let mut lists = read_config_lists(&config_path);
    lists.favorites.clone_from(favorites);
    write_config_lists(config_path, &lists)
}

/// One tab the app puts back after a restart. It is deliberately only the document now showing, not the tab's Back list.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionTab {
    pub path: PathBuf,
    pub title: String,
    pub code_view: bool,
    pub anchor: Option<ScrollAnchor>,
    pub saved_code_scroll: Option<f64>,
    /// Whether this entry is a note that never got a file, so there is nothing to reopen and the words below are the whole document. A flag of its own rather than a test on the path: the name a new note wears is a bare relative one, so asking whether it is a file resolves it against the folder the app was started in, and an `Untitled.md` sitting there would come back in place of the note.
    pub untitled: bool,
    /// The unsaved buffer as it stood when the window closed, so the edits come back rather than being discarded without a word. `None` for a clean tab, and written by the close alone — a mid-run save would rewrite this file at every pause in typing.
    pub unsaved_text: Option<String>,
    /// The same tab's text as it was last written to disk, which is what the next launch compares the file against before it puts the buffer back. The text rather than a hash: the app's own hash is per-run, so one written here would stop matching after every app update and silently drop the edits.
    pub saved_text: Option<String>,
}

/// The open workspace remembered in the app config. `active` is `None` when the home screen was showing.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Session {
    pub tabs: Vec<SessionTab>,
    pub active: Option<usize>,
}

/// UI toggles that survive a restart. The app shell's opaque origin can't use localStorage, so the host owns these: injected on boot via [`initial_settings_script`] and saved whenever the frontend reports a change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// The open tabs and front tab from the last session.
    pub session: Session,
    /// Quiet prose and add bold lead anchors at word starts. Off by default.
    pub speed_reader_enabled: bool,
    /// The code view's typing help: note and heading suggestions, and the underline on links that lead nowhere. On by default.
    pub code_intel_enabled: bool,
    /// The padlocks, one per editable view: typing in the page and typing in the source are two different risks, so unlocking one is not consent to the other. Both off by default, the safe way round to be wrong.
    pub reading_unlocked: bool,
    pub code_unlocked: bool,
    /// Selected theme family: `github`/`nightshade`/`amaranth`/… Raw frontend string; the frontend normalizes anything unexpected back to `github`.
    pub theme_family: String,
    /// Last appearance mode: `system`/`light`/`dark`/`daylight`. Raw frontend string; the frontend normalizes anything unexpected back to `system`.
    pub theme_mode: String,
    /// Families already shown in the current random-theme cycle. When the theme family is `random`, the frontend draws a fresh family at each launch and appends it here so none repeats until every family has shown, then resets.
    pub theme_random_used: Vec<String>,
    /// How much of the link graph the graph view draws (see [`GraphScope`]).
    pub graph_scope: GraphScope,
    /// The folder the library pane is inside (empty string = the root). Restored on launch, so the pane reopens where it was left.
    pub library_project_path: String,
    /// Whether the library pane is collapsed shut. Open by default.
    pub library_closed: bool,
    /// The pane's last open width in CSS px. The frontend re-clamps it to the window, so it's a preference, not a command.
    pub library_width: u32,
    /// The window's last inner size in logical px, so it reopens where the user left it. Logical so it round-trips across monitors of different scale.
    pub window_width: u32,
    pub window_height: u32,
    /// Whether the window was maximized at last close. Tracked apart from the size so un-maximizing returns to the windowed dimensions.
    pub window_maximized: bool,
    /// Unix seconds of the last release check, so launches don't each spend a request against GitHub's unauthenticated rate limit.
    pub update_last_checked: u64,
    /// Version of the verified installer waiting on disk, empty when none is.
    pub update_staged_version: String,
    /// Version the app already tried to install by itself at launch: one automatic attempt each, then the button. Without it, a failing installer boot-loops.
    #[serde(default)]
    pub update_auto_applied: String,
    /// Launches that had a first-run hint to draw. A launch whose target was not on screen is not counted, so the hint waits for one where it can be pointed at rather than being spent on a shut pane.
    pub hint_launches: u32,
    /// First-run hints already met — the pointer reached the control the bubble pointed at, or it was pressed. A name in here never shows again on this install.
    pub hints_seen: Vec<String>,
    /// The launch count the last bubble showed at, so the next hint waits out a quiet launch. One number for every hint, because only one bubble can show in a launch.
    pub hint_last_launch: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            session: Session::default(),
            speed_reader_enabled: false,
            code_intel_enabled: true,
            reading_unlocked: false,
            code_unlocked: false,
            theme_family: "random".to_string(),
            theme_mode: "daylight".to_string(),
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
            hint_launches: 0,
            hints_seen: Vec::new(),
            hint_last_launch: 0,
        }
    }
}

/// How much of the link graph the graph view draws. `Small` focuses on the open document (or recents on the start screen) plus everything one link away; the rest cap the densest documents at increasing sizes up to `Xl` (everything). Serialized lowercase to match `GRAPH_SCOPES`. Small is the default.
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

#[cfg(feature = "desktop")]
pub fn settings_file_path() -> Option<PathBuf> {
    project_config_dir().map(|dir| dir.join("settings.json"))
}

/// What [`load_settings`] found. An unreadable file and no file at all both end in [`Settings::default()`], so without this flag the app opens factory-fresh with nothing to say that someone's saved choices were skipped.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SettingsLoad {
    pub settings: Settings,
    /// A file was there and did not parse — false for the ordinary first launch.
    pub unreadable: bool,
}

/// Load the persisted UI toggles, falling back to defaults when the file is missing or corrupt.
pub fn load_settings(settings_path: impl AsRef<Path>) -> SettingsLoad {
    let text = read_config_text(settings_path);
    let parsed: Option<Settings> = text
        .as_ref()
        .ok()
        .and_then(|contents| serde_json::from_str(contents).ok());
    // Read but not parsed: the file is there and we are about to ignore it.
    let unreadable = text.is_ok() && parsed.is_none();
    let mut settings = parsed.unwrap_or_default();
    // Migrate the pre-family single-axis setting: Dracula used to be a theme "mode"; it's now the dark half of the Nightshade family (the renamed Dracula palette).
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
