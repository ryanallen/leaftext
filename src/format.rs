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
    Html,
    Text,
    Ini,
    Docx,
    Xlsx,
    Pptx,
    Odt,
    Ods,
    Odp,
    Code,
}

/// How a format's files arrive: as text the loader decoded, or as the bytes on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceShape {
    Text,
    Bytes,
}

impl DocumentFormat {
    /// Every format, in the order the file dialog lists them. Callers derive their lists from this rather than restating one.
    pub const ALL: [Self; 15] = [
        Self::Markdown,
        Self::Xml,
        Self::Json,
        Self::Yaml,
        Self::Eml,
        Self::Html,
        Self::Text,
        Self::Ini,
        Self::Docx,
        Self::Xlsx,
        Self::Pptx,
        Self::Odt,
        Self::Ods,
        Self::Odp,
        Self::Code,
    ];

    /// The extensions that name this format, lowercase and without the dot. The first is canonical; the rest are accepted spellings.
    ///
    /// `const` so a const table can take its endings from here rather than restating them.
    pub const fn extensions(self) -> &'static [&'static str] {
        match self {
            // `.mdc` is Cursor's project rule: Markdown with a frontmatter block, which this reader already draws. It is readable but not writable — `MARKDOWN_EXPORT_EXTENSIONS` below is what an export offers.
            Self::Markdown => &["md", "markdown", "mdown", "mdc"],
            Self::Xml => &["xml"],
            Self::Json => &["json"],
            Self::Yaml => &["yaml", "yml"],
            // MHT web archives are the same MIME envelope as mail, so the one reader opens both.
            Self::Eml => &["eml", "mht", "mhtml"],
            Self::Html => &["html", "htm"],
            // The commonest text file there is, and the app was never told what shape one holds — so it is kept exactly as typed rather than read as prose.
            Self::Text => &["txt"],
            // A config file is a page of sections rather than a colored block, so it has its own reader and its own arm — which is why `SOURCE_DEFINITIONS` below does not name it.
            Self::Ini => &["ini"],
            // The six packaged formats: a zip of XML rather than a file somebody typed. The macro-enabled spellings ride the arm they belong to rather than taking a variant of their own — a `.docm` is a `.docx` whose package also carries a macro, and the reader asks for `word/document.xml` either way.
            Self::Docx => &["docx", "docm"],
            Self::Xlsx => &["xlsx", "xlsm"],
            Self::Pptx => &["pptx", "pptm"],
            Self::Odt => &["odt"],
            Self::Ods => &["ods"],
            Self::Odp => &["odp"],
            // Source endings come from `SOURCE_DEFINITIONS`; the file dialog asks `source_extensions` so this arm cannot become a second list.
            Self::Code => &[],
        }
    }

    /// The named format an extension spells, or `None` when no arm above claims it — the source table is not asked. Matched against the static spellings themselves, so asking costs no lowercased copy: every path a folder, vault, graph or pager meets asks this once per file.
    fn named_format_for_extension(extension: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|format| {
            format
                .extensions()
                .iter()
                .any(|spelling| spelling.eq_ignore_ascii_case(extension))
        })
    }

    /// The format an extension names, or `None` when the app can't read it. Case-insensitive: extensions arrive from the filesystem as typed.
    pub fn from_extension(extension: &str) -> Option<Self> {
        Self::named_format_for_extension(extension)
            .or_else(|| source_definition_for_extension(extension).map(|_| Self::Code))
    }

    /// The format `path` names, or `None` when the app can't read it. This is the question to ask before opening a file; [`Self::from_path`] is the one to ask once it is already open.
    pub fn for_path(path: &Path) -> Option<Self> {
        path.extension()
            .and_then(|extension| extension.to_str())
            .and_then(Self::from_extension)
            .or_else(|| source_definition_for_path(path).map(|_| Self::Code))
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
            Self::Html => "html",
            Self::Text => "text",
            Self::Ini => "ini",
            // The code view shows one member of the package, and every member this app reads is XML.
            Self::Docx | Self::Xlsx | Self::Pptx | Self::Odt | Self::Ods | Self::Odp => "xml",
            Self::Code => "text",
        }
    }

    /// Whether this format's files reach the app as decoded text or as raw bytes.
    ///
    /// Text is the path every format had until an Office file arrived: the loader decodes by the byte order mark and refuses anything holding a zero byte, which is a file this app cannot render as words. A zipped format is that refusal's whole point — its second byte is `K` and its fifth is zero — so it has to reach its reader before any of that runs.
    pub const fn source_shape(self) -> SourceShape {
        match self {
            Self::Markdown
            | Self::Xml
            | Self::Json
            | Self::Yaml
            | Self::Eml
            | Self::Html
            | Self::Text
            | Self::Ini
            | Self::Code => SourceShape::Text,
            Self::Docx | Self::Xlsx | Self::Pptx | Self::Odt | Self::Ods | Self::Odp => {
                SourceShape::Bytes
            }
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
            Self::Html => "HTML",
            Self::Text => "Text",
            Self::Ini => "INI",
            Self::Docx => "Word document",
            Self::Xlsx => "Excel workbook",
            Self::Pptx => "PowerPoint presentation",
            Self::Odt => "OpenDocument text",
            Self::Ods => "OpenDocument spreadsheet",
            Self::Odp => "OpenDocument presentation",
            Self::Code => "Source code",
        }
    }
}

/// One source-file definition: all admissions and the matching highlighter token live here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceDefinition {
    pub extensions: &'static [&'static str],
    pub file_names: &'static [&'static str],
    pub language_token: &'static str,
    pub display_name: &'static str,
}

pub const SOURCE_DEFINITIONS: &[SourceDefinition] = &[
    SourceDefinition {
        extensions: &["ts"],
        file_names: &[],
        language_token: "typescript",
        display_name: "TypeScript",
    },
    SourceDefinition {
        extensions: &["tsx"],
        file_names: &[],
        language_token: "tsx",
        display_name: "TSX",
    },
    SourceDefinition {
        extensions: &["js"],
        file_names: &[],
        language_token: "javascript",
        display_name: "JavaScript",
    },
    SourceDefinition {
        extensions: &["jsx"],
        file_names: &[],
        language_token: "jsx",
        display_name: "JSX",
    },
    SourceDefinition {
        extensions: &["jsonc"],
        file_names: &[],
        language_token: "jsonc",
        display_name: "JSONC",
    },
    SourceDefinition {
        extensions: &["css"],
        file_names: &[],
        language_token: "css",
        display_name: "CSS",
    },
    SourceDefinition {
        extensions: &["scss"],
        file_names: &[],
        language_token: "scss",
        display_name: "SCSS",
    },
    SourceDefinition {
        extensions: &["sh", "bash", "zsh"],
        file_names: &[],
        language_token: "sh",
        display_name: "Bash",
    },
    SourceDefinition {
        extensions: &["toml"],
        file_names: &[],
        language_token: "toml",
        display_name: "TOML",
    },
    SourceDefinition {
        extensions: &["rs"],
        file_names: &[],
        language_token: "rust",
        display_name: "Rust",
    },
    SourceDefinition {
        extensions: &["py"],
        file_names: &[],
        language_token: "python",
        display_name: "Python",
    },
    SourceDefinition {
        extensions: &["sql"],
        file_names: &[],
        language_token: "sql",
        display_name: "SQL",
    },
    SourceDefinition {
        extensions: &["diff", "patch"],
        file_names: &[],
        language_token: "diff",
        display_name: "Diff",
    },
    SourceDefinition {
        extensions: &["env"],
        file_names: &[".env"],
        language_token: "dotenv",
        display_name: "Dotenv",
    },
    SourceDefinition {
        extensions: &["graphql", "gql"],
        file_names: &[],
        language_token: "graphql",
        display_name: "GraphQL",
    },
    SourceDefinition {
        extensions: &[],
        file_names: &["Dockerfile"],
        language_token: "dockerfile",
        display_name: "Dockerfile",
    },
];

pub fn source_definitions() -> &'static [SourceDefinition] {
    SOURCE_DEFINITIONS
}

/// The source definition an extension spells. Matched against the static spellings themselves, so an extension arrives as it was typed on disk and no lowercased copy is made to ask.
pub fn source_definition_for_extension(extension: &str) -> Option<SourceDefinition> {
    SOURCE_DEFINITIONS.iter().copied().find(|definition| {
        definition
            .extensions
            .iter()
            .any(|spelling| spelling.eq_ignore_ascii_case(extension))
    })
}

/// The source definition `path` names, by whole file name first and then by extension. The two are asked one after the other rather than the extension table being asked again inside every definition, which is the same answer for one walk instead of sixteen — only `.env` and `Dockerfile` are named as whole files, and neither has an extension to disagree with.
pub fn source_definition_for_path(path: &Path) -> Option<SourceDefinition> {
    let file_name = path.file_name()?.to_str()?;
    SOURCE_DEFINITIONS
        .iter()
        .copied()
        .find(|definition| {
            definition
                .file_names
                .iter()
                .any(|name| name.eq_ignore_ascii_case(file_name))
        })
        .or_else(|| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .and_then(source_definition_for_extension)
        })
}

pub fn source_extensions() -> Vec<&'static str> {
    SOURCE_DEFINITIONS
        .iter()
        .flat_map(|definition| definition.extensions)
        .copied()
        .collect()
}

pub fn source_definition(path: &Path) -> Option<SourceDefinition> {
    source_definition_for_path(path)
}

/// The Markdown endings an export may write, which is not every ending the app reads. A diagram or a picture exported as Markdown writes an ordinary document with no frontmatter, so offering `.mdc` there would name a Cursor rule over a file that is not one. Readable spellings are [`DocumentFormat::extensions`] above; both lists stay in this file so neither becomes a second table.
pub const MARKDOWN_EXPORT_EXTENSIONS: &[&str] = &["md", "markdown", "mdown"];

/// Every readable extension, in format order. The file dialog's combined filter and anything else that needs the flat list.
pub fn all_document_extensions() -> Vec<&'static str> {
    DocumentFormat::ALL
        .into_iter()
        .flat_map(DocumentFormat::extensions)
        .copied()
        .chain(source_extensions())
        .collect()
}

/// True when `path` names a file the app can open. The one answer behind the file dialog, drag-and-drop, in-app link following, the pager and the library pane, so all five agree on what a document is.
pub fn is_supported_document_path(path: &Path) -> bool {
    DocumentFormat::for_path(path).is_some()
}

/// True when `path` belongs in a folder, pager, corpus, or graph. Source files open when named, without turning a repository into a library of its code — so this asks the named formats alone rather than recognizing a source file in order to refuse it. That is the whole of the answer: every question here ends in the named table, and a folder of pictures and build output never touches the source table at all.
pub fn is_listed_document_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(DocumentFormat::named_format_for_extension)
        .is_some()
}
