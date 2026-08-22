//! What the app reads: the one table of formats and the extensions that name them. The file dialog, drag-and-drop, the link classifier, the pager, the library pane, the render router and the code view all ask this one. A second list anywhere drifts, and drift here is silent — a file opens but its folder won't page, or a link to it leaves the app.
//!
//! Adding a format means adding an arm here. Every match on `DocumentFormat` is exhaustive on purpose, so the compiler names each site that has to answer for the new arm instead of leaving it silently reading as Markdown.

use crate::*;

/// A document's format, from its file extension. Picks which renderer builds the reading view, how the code view colors the source, and what the app admits it can open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    Markdown,
    Xml,
    Json,
    Yaml,
    Eml,
}

impl DocumentFormat {
    /// Every format, in the order the file dialog lists them. Callers derive their lists from this rather than restating one.
    pub const ALL: [Self; 5] = [Self::Markdown, Self::Xml, Self::Json, Self::Yaml, Self::Eml];

    /// The extensions that name this format, lowercase and without the dot. The first is canonical; the rest are accepted spellings.
    ///
    /// `const` so a const table can take its endings from here rather than restating them.
    pub const fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::Markdown => &["md", "markdown", "mdown"],
            Self::Xml => &["xml"],
            Self::Json => &["json"],
            Self::Yaml => &["yaml", "yml"],
            // MHT web archives are the same MIME envelope as mail, so the one reader opens both.
            Self::Eml => &["eml", "mht", "mhtml"],
        }
    }

    /// The format an extension names, or `None` when the app can't read it. Case-insensitive: extensions arrive from the filesystem as typed.
    pub fn from_extension(extension: &str) -> Option<Self> {
        let extension = extension.to_ascii_lowercase();
        Self::ALL
            .into_iter()
            .find(|format| format.extensions().contains(&extension.as_str()))
    }

    /// The format `path` names, or `None` when the app can't read it. This is the question to ask before opening a file; [`Self::from_path`] is the one to ask once it is already open.
    pub fn for_path(path: &Path) -> Option<Self> {
        path.extension()
            .and_then(|extension| extension.to_str())
            .and_then(Self::from_extension)
    }

    /// The format to render `path` as, falling back to Markdown for anything unrecognized. The loader is total — a file that reached it gets rendered as something — so extension-less READMEs read as Markdown rather than failing to open.
    pub fn from_path(path: &Path) -> Self {
        Self::for_path(path).unwrap_or(Self::Markdown)
    }

    /// The token the syntax highlighter uses to pick a language definition.
    pub fn language_token(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Xml => "xml",
            Self::Json => "json",
            Self::Yaml => "yaml",
            // No email grammar is bundled; the code view falls back to plain text, which still edits and minimaps.
            Self::Eml => "email",
        }
    }

    /// The label shown on the code view, the file dialog's per-format filter, and the fallback highlight class.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Markdown => "Markdown",
            Self::Xml => "XML",
            Self::Json => "JSON",
            Self::Yaml => "YAML",
            Self::Eml => "Email",
        }
    }
}

/// Every readable extension, in format order. The file dialog's combined filter and anything else that needs the flat list.
pub fn all_document_extensions() -> Vec<&'static str> {
    DocumentFormat::ALL
        .into_iter()
        .flat_map(DocumentFormat::extensions)
        .copied()
        .collect()
}

/// True when `path` names a file the app can open. The one answer behind the file dialog, drag-and-drop, in-app link following, the pager and the library pane, so all five agree on what a document is.
pub fn is_supported_document_path(path: &Path) -> bool {
    DocumentFormat::for_path(path).is_some()
}
