//! The editing model: the source-backed document buffer, the code (raw source)
//! view renderer, and the Markdown block source map that later in-viewer editing
//! stands on. This is the Rust half of the "source is truth" design: Rust owns
//! the editable text, the webview is the interaction shell.
//!
//! Steps 1–3 of the editing plan only need whole-buffer edits (the browser
//! `<textarea>` is the live editor in the code view; Rust receives the full text
//! on debounced updates and on save). The finer piece-table / inline-span model
//! that live in-viewer editing needs lands with the later build steps.

use crate::*;

/// Which source language a document is, decided by its file extension. This is
/// what tells the code view whether to colour the raw text as Markdown or as
/// XML, and which renderer rebuilds the reading view from an edited buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    Markdown,
    Xml,
}

impl DocumentFormat {
    /// The format for a path, from its extension. Anything that is not a
    /// recognized XML/TEI extension is treated as Markdown, matching how the
    /// loader routes files (only `.xml` goes through the TEI renderer).
    pub fn from_path(path: &Path) -> Self {
        match path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("xml") => Self::Xml,
            _ => Self::Markdown,
        }
    }

    /// The token the syntax highlighter uses to pick a language definition.
    pub fn language_token(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Xml => "xml",
        }
    }

    /// The label shown on the code view, and the fallback highlight class.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Markdown => "Markdown",
            Self::Xml => "XML",
        }
    }
}

/// A document open for editing: Rust's authoritative copy of the source text.
///
/// `text` is the live buffer (what a save would write); `saved` is the text as
/// it last was on disk, so "is there anything to save" is just `text != saved`.
/// `version` increments on every save so the file watcher can tell a save this
/// process just made from an edit that landed from outside.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditableDocument {
    pub path: PathBuf,
    pub format: DocumentFormat,
    text: String,
    saved: String,
    version: u64,
}

impl EditableDocument {
    /// Start an editing session for `path` seeded with `contents` (the text
    /// already on disk / on screen), which becomes both the live buffer and the
    /// saved baseline, so a freshly opened document is not dirty.
    pub fn new(path: PathBuf, contents: String) -> Self {
        let format = DocumentFormat::from_path(&path);
        Self {
            path,
            format,
            saved: contents.clone(),
            text: contents,
            version: 0,
        }
    }

    /// The live buffer contents.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Replace the whole buffer (the code view sends the full textarea value on
    /// each debounced change). Returns whether the dirty state changed, so the
    /// caller only pushes a tab-indicator update when it actually flips.
    pub fn set_text(&mut self, text: String) -> bool {
        let was_dirty = self.is_dirty();
        self.text = text;
        was_dirty != self.is_dirty()
    }

    /// Whether the buffer differs from what was last written to disk.
    pub fn is_dirty(&self) -> bool {
        self.text != self.saved
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    /// Record that the current buffer was written to disk: the buffer becomes
    /// the saved baseline (so dirty clears) and the version advances.
    pub fn mark_saved(&mut self) {
        self.saved = self.text.clone();
        self.version += 1;
    }

    /// Adopt `contents` as a fresh on-disk baseline without going through a
    /// save — used when an external change is accepted into a clean buffer so
    /// the live-reload keeps the code view in step with the file.
    pub fn adopt_external(&mut self, contents: String) {
        self.saved = contents.clone();
        self.text = contents;
    }

    /// The highlighted source for the code view's colour layer.
    pub fn source_view_html(&self) -> String {
        render_source_view_html(&self.text, self.format)
    }
}

/// Highlight raw source text for the code view, reusing the reader's own Rust
/// highlighter (`highlight_code`) — the same path that colours fenced code
/// blocks, which already covers both Markdown and XML. Returns the inner markup
/// for a `<code>` element (syntect `syn-*` spans over HTML-escaped text). Falls
/// back to plainly escaped text when the language has no syntax definition, so
/// the code view always shows the file even if colouring is unavailable.
pub fn render_source_view_html(source: &str, format: DocumentFormat) -> String {
    language_definition(format.language_token())
        .and_then(|language| highlight_code(source, &language))
        .unwrap_or_else(|| encode_text(source).to_string())
}

/// One top-level block in a Markdown document, tying a stable id and a kind to
/// the exact byte range in the source it came from. This is the offset map that
/// later in-viewer editing uses to edit a single block's source in place and
/// re-render only that block; it is produced with pulldown-cmark's
/// `into_offset_iter()`, which yields each event's source range.
///
/// Markdown only, by nature: `into_offset_iter()` is a pulldown-cmark
/// capability. TEI/XML has no equivalent free offset map and stays read-only
/// until its renderer is taught to carry source ranges too.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlockSpan {
    pub id: usize,
    pub kind: &'static str,
    pub start: usize,
    pub end: usize,
}

/// Map every top-level block of `markdown` to its source byte range. Nested
/// blocks (list items, table cells, inline spans) are folded into their
/// enclosing top-level block's range; those get their own spans when inline
/// mapping arrives in a later step.
pub fn block_source_map(markdown: &str) -> Vec<BlockSpan> {
    let parser = Parser::new_ext(markdown, markdown_options()).into_offset_iter();
    let mut spans = Vec::new();
    let mut depth = 0usize;
    let mut next_id = 0usize;

    for (event, range) in parser {
        match &event {
            Event::Start(tag) => {
                if depth == 0 {
                    if let Some(kind) = block_kind(tag) {
                        spans.push(BlockSpan {
                            id: next_id,
                            kind,
                            start: range.start,
                            end: range.end,
                        });
                        next_id += 1;
                    }
                }
                depth += 1;
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            // Thematic breaks and raw HTML blocks are leaf events with no
            // Start/End pair, but they are still top-level blocks worth mapping.
            Event::Rule if depth == 0 => {
                spans.push(BlockSpan {
                    id: next_id,
                    kind: "rule",
                    start: range.start,
                    end: range.end,
                });
                next_id += 1;
            }
            Event::Html(_) if depth == 0 => {
                spans.push(BlockSpan {
                    id: next_id,
                    kind: "html_block",
                    start: range.start,
                    end: range.end,
                });
                next_id += 1;
            }
            _ => {}
        }
    }

    spans
}

/// The block kind name for a top-level container tag, or `None` for tags that
/// only ever appear nested inside another block (list items, table parts,
/// inline emphasis, links, images).
fn block_kind(tag: &Tag<'_>) -> Option<&'static str> {
    match tag {
        Tag::Paragraph => Some("paragraph"),
        Tag::Heading { .. } => Some("heading"),
        Tag::BlockQuote(_) => Some("blockquote"),
        Tag::CodeBlock(_) => Some("code_block"),
        Tag::HtmlBlock => Some("html_block"),
        Tag::List(_) => Some("list"),
        Tag::Table(_) => Some("table"),
        Tag::FootnoteDefinition(_) => Some("footnote_definition"),
        Tag::DefinitionList => Some("definition_list"),
        Tag::MetadataBlock(_) => Some("metadata_block"),
        _ => None,
    }
}
