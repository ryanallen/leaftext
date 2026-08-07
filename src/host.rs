//! What the core asks the host it is running in for.
//!
//! **Two halves.** The first is what a *render* needs and cannot get from the document's own text: the vault's field types, the repository a `#123` resolves against, an image's own pixel size, and the nearest glossary — four files on this machine, plus resolving a path and taking a line of log. A browser page has no disk to answer any of them, so they are the host's rather than the renderer's, and a host that answers none renders the document without those four decorations rather than failing.
//!
//! The second is what the *page* asks for: open a document, save one, tell the host the source changed, follow a link, search a vault, draw a map, find an asset, fetch the highlighter, and read or write the reader's settings. Those are the commands the desktop's page already sends over its own channel, and the desktop answers them through here. Every one has a default that refuses, so a host answers what it can and no more.
//!
//! Every method has a default, so a host implements what it can answer and nothing else. [`DesktopHost`] is this machine; [`BareHost`] is a host with no answers at all, which is what proves the interface is optional rather than load-bearing.
//!
//! A browser answers the same interface. `web/` is the module it reaches it through, and what it cannot answer — the file dialog, the Recycle Bin, git, the updater — it simply does not.

use crate::markdown::RepositoryContext;
use crate::store::{DocumentGraph, GraphRequest, SearchResults, TypeOverrides};
use crate::{OpenedDocument, Query, Settings, SourceText};
use std::io;
use std::path::{Path, PathBuf};

/// One `## Term` from a glossary, and the anchor a link to it lands on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlossaryTerm {
    pub term: String,
    pub slug: String,
}

pub trait LeafHost {
    /// The path the render works in. The desktop resolves it against the disk so a document reached through a link or a shortcut renders the same as one opened directly; a host with no disk keeps what it was given.
    fn resolve_path(&self, path: &Path) -> PathBuf {
        path.to_path_buf()
    }

    /// What the vault says a frontmatter field is, over what the value's own shape said.
    fn field_types(&self, _document: &Path) -> TypeOverrides {
        TypeOverrides::default()
    }

    /// The GitHub repository an issue or pull-request reference in this document resolves against.
    fn repository(&self, _document_dir: &Path) -> Option<RepositoryContext> {
        None
    }

    /// An image's own pixel size, stamped onto the tag so the page does not reflow when it loads.
    fn image_size(&self, _image: &Path) -> Option<(u32, u32)> {
        None
    }

    /// The terms of the nearest glossary, longest first, for auto-linking.
    fn glossary_terms(&self, _document_dir: &Path) -> Vec<GlossaryTerm> {
        Vec::new()
    }

    /// One line about something in the document the render could not read.
    fn log(&self, _message: &str) {}

    // The commands the page sends, each with a default that refuses: a host answers what it can reach.

    /// Read a document and render it. The one call that turns a path into something on screen.
    fn load(&self, path: &Path) -> io::Result<OpenedDocument> {
        Err(no_such_host(path))
    }

    /// Write the document's buffer back. Nothing saves without this being asked for. It takes the text with its spelling, not a bare string, because a file that arrived as UTF-16 has to leave as UTF-16 — a host that has no such notion hands over [`SourceText::utf8`](crate::SourceText::utf8).
    fn save(&self, path: &Path, _text: &SourceText) -> io::Result<()> {
        Err(no_such_host(path))
    }

    /// The source changed by this much, as the range it replaced rather than the whole buffer. The host holds the buffer, so it is told rather than asked.
    fn splice_source(&self, _edit: SourceSplice<'_>) {}

    /// Follow a link the reader clicked — another document, or an address outside the app.
    fn open_link(&self, _target: &str) {}

    /// Filter the vault's text. The vault is whatever text this host was handed, because reading a folder tree on every keystroke is the one thing this app will not do.
    ///
    /// It carries the two things a typed query cannot do without, and which a browser needs for the same reasons as the desktop: `within` narrows the scan to the paths a shorter query already matched, since a longer one can only ever match fewer, and `overtaken` is checked between documents so a query nobody will read any more stops rather than finishes. `None` back means overtaken — not that nothing matched.
    fn search(
        &self,
        _query: &Query,
        _within: Option<&[String]>,
        _overtaken: &dyn Fn() -> bool,
    ) -> Option<SearchResults> {
        Some(SearchResults::default())
    }

    /// The Previous/Next strip under a document, which only a host that can see the document's neighbors can fill. The desktop answers with its waiting state and fills it once it has walked the folder; a host that cannot answers nothing, and the document simply ends where it ends rather than sitting under a strip that will never load.
    fn pager_placeholder(&self) -> Option<&'static str> {
        None
    }

    /// The map around a document, sliced as asked.
    fn graph(&self, _seed: &Path, _request: &GraphRequest) -> DocumentGraph {
        DocumentGraph {
            nodes: Vec::new(),
            edges: Vec::new(),
            truncated: false,
        }
    }

    /// Where a bundled asset lives. The scheme is the host's to choose — the desktop serves its own, and a web page serves a URL.
    fn asset_url(&self, _name: &str) -> Option<String> {
        None
    }

    /// Where the highlighter module lives, fetched only once a document turns out to have a fenced code block. A host that answers `None` keeps plain code, which is the same bargain as the four reads above.
    fn highlighter_url(&self) -> Option<String> {
        None
    }

    /// The reader's own choices, which the page cannot keep for itself — the app shell's opaque origin has no storage of its own.
    fn settings(&self) -> Settings {
        Settings::default()
    }

    /// The reader changed one of them.
    fn set_settings(&self, _settings: &Settings) {}
}

/// One edit to the open document's source: the range it replaced, counted in UTF-16 units because that is what the code view speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceSplice<'a> {
    pub start: usize,
    pub removed: usize,
    pub inserted: &'a str,
}

/// What a host that cannot reach a file says, rather than pretending the file was missing.
fn no_such_host(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        format!("this host cannot reach {}", path.display()),
    )
}

/// The app on this machine: every read is the file it always was.
///
/// Three of the commands cannot be answered by the library alone — where the reader's settings are kept, the vault's text, which is held in memory precisely so a keystroke does not read a folder tree, and handing a link to the OS, which is a process this crate does not start. So the running app hands those over when it has them, and a `DesktopHost::default()` — which is what the render path itself uses — answers the six reads and refuses the three.
#[derive(Clone, Copy, Default)]
pub struct DesktopHost<'a> {
    pub settings_path: Option<&'a Path>,
    pub vault: Option<&'a crate::VaultCorpus>,
    pub open_with_os: Option<&'a dyn Fn(&str)>,
}

impl LeafHost for DesktopHost<'_> {
    fn resolve_path(&self, path: &Path) -> PathBuf {
        std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
    }

    fn field_types(&self, document: &Path) -> TypeOverrides {
        crate::store::vault_types_for(document)
    }

    fn repository(&self, document_dir: &Path) -> Option<RepositoryContext> {
        crate::markdown::repository_context(document_dir)
    }

    fn image_size(&self, image: &Path) -> Option<(u32, u32)> {
        crate::markdown::image_pixel_size(image)
    }

    fn glossary_terms(&self, document_dir: &Path) -> Vec<GlossaryTerm> {
        crate::nearest_glossary_terms(document_dir)
    }

    fn log(&self, message: &str) {
        eprintln!("{message}");
    }

    fn load(&self, path: &Path) -> io::Result<OpenedDocument> {
        crate::load_document(path)
    }

    fn save(&self, path: &Path, text: &SourceText) -> io::Result<()> {
        crate::write_source(path, &text.text, text.spelling)
    }

    fn open_link(&self, target: &str) {
        if let Some(open) = self.open_with_os {
            open(target);
        }
    }

    fn search(
        &self,
        query: &Query,
        within: Option<&[String]>,
        overtaken: &dyn Fn() -> bool,
    ) -> Option<SearchResults> {
        let vault = self.vault?;
        vault.search_until(query, within, overtaken)
    }

    fn graph(&self, seed: &Path, request: &GraphRequest) -> DocumentGraph {
        crate::document_graph(seed, request)
    }

    fn pager_placeholder(&self) -> Option<&'static str> {
        crate::pager_loading_html()
    }

    fn asset_url(&self, name: &str) -> Option<String> {
        Some(crate::bundled_asset_url(name))
    }

    /// The desktop compiles the highlighter in, so there is nothing to fetch. Only a browser core has a second module.
    fn highlighter_url(&self) -> Option<String> {
        None
    }

    fn settings(&self) -> Settings {
        self.settings_path
            .map(|path| crate::load_settings(path).settings)
            .unwrap_or_default()
    }

    fn set_settings(&self, settings: &Settings) {
        if let Some(path) = self.settings_path {
            let _ = crate::save_settings(path, settings);
        }
    }

    // Splicing is not answered here: the desktop's event loop holds the open buffer and applies the edit to it, so it is told rather than asked. See `LeafHost::splice_source`.
}

/// A host that answers nothing: the document renders, and the four decorations are simply absent. It is what a browser gets before anybody hands it anything, and it is how the interface is proved to be optional rather than load-bearing.
#[derive(Debug, Clone, Copy, Default)]
pub struct BareHost;

impl LeafHost for BareHost {}
