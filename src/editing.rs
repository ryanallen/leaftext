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
/// How many reading-view edits the in-memory undo stack keeps per document.
/// Each entry is a full buffer snapshot; documents are small, so 200 is cheap.
const UNDO_STACK_CAP: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditableDocument {
    pub path: PathBuf,
    pub format: DocumentFormat,
    text: String,
    saved: String,
    version: u64,
    /// Buffer snapshots taken before each reading-view edit (block splices and
    /// checkbox toggles), newest last. The browser's native undo cannot cross
    /// the re-render an edit triggers, so undo for inline edits lives here with
    /// the buffer itself. Code-view typing is NOT snapshotted — the textarea's
    /// own undo already covers it keystroke by keystroke.
    undo_stack: Vec<String>,
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
            undo_stack: Vec::new(),
        }
    }

    /// Record `before` as an undo point if the buffer actually changed, keeping
    /// the stack bounded.
    fn push_undo(&mut self, before: String) {
        if before == self.text {
            return;
        }
        self.undo_stack.push(before);
        if self.undo_stack.len() > UNDO_STACK_CAP {
            self.undo_stack.remove(0);
        }
    }

    /// Revert the most recent reading-view edit. Returns whether anything was
    /// undone. Undoing past a save is allowed — the buffer just becomes dirty
    /// against the saved baseline again.
    pub fn undo(&mut self) -> bool {
        match self.undo_stack.pop() {
            Some(previous) => {
                self.text = previous;
                true
            }
            None => false,
        }
    }

    /// Whether there is a reading-view edit to undo.
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
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

    /// Splice `replacement` into the buffer over the byte range `[start, end)`.
    /// This is the core of source-anchored in-viewer editing: a block (or a text
    /// run inside it) maps to an exact source range, and an edit replaces just
    /// that range, leaving the rest of the file untouched. Works the same for
    /// Markdown and XML because both are plain source text.
    ///
    /// The range is clamped to the buffer and snapped outward to the nearest
    /// char boundaries so a bad offset can never panic or corrupt UTF-8; a range
    /// whose start is past its end is treated as an insertion at `start`. Returns
    /// whether the dirty state changed.
    pub fn replace_range(&mut self, start: usize, end: usize, replacement: &str) -> bool {
        let len = self.text.len();
        let mut start = start.min(len);
        let mut end = end.min(len);
        if start > end {
            end = start;
        }
        while !self.text.is_char_boundary(start) {
            start -= 1;
        }
        while !self.text.is_char_boundary(end) {
            end += 1;
        }
        let was_dirty = self.is_dirty();
        let before = self.text.clone();
        self.text.replace_range(start..end, replacement);
        self.push_undo(before);
        was_dirty != self.is_dirty()
    }

    /// Toggle the `index`-th task-list marker between checked and unchecked by
    /// flipping the single state byte between its brackets (`[ ]` ⇄ `[x]`). This
    /// is what an interactive checkbox in the reading view drives. The offset is
    /// recomputed from the live buffer so it stays correct after other edits, and
    /// the replacement is one ASCII byte for another, so no later offset shifts.
    /// Returns whether the dirty state changed. An out-of-range index is a no-op.
    /// Markdown only — TEI/XML has no task markers.
    pub fn toggle_task(&mut self, index: usize) -> bool {
        if self.format != DocumentFormat::Markdown {
            return false;
        }
        let Some(&offset) = task_marker_offsets(&self.text).get(index) else {
            return false;
        };
        let currently_checked = self
            .text
            .as_bytes()
            .get(offset)
            .is_some_and(|byte| *byte != b' ');
        let was_dirty = self.is_dirty();
        let before = self.text.clone();
        self.text.replace_range(
            offset..offset + 1,
            if currently_checked { " " } else { "x" },
        );
        self.push_undo(before);
        was_dirty != self.is_dirty()
    }

    /// The block source map for the live buffer, in the buffer's own format:
    /// Markdown blocks via pulldown-cmark offsets, XML blocks via roxmltree node
    /// ranges. This is what the reading view attaches to rendered blocks so an
    /// edit knows which source range to splice.
    pub fn block_source_map(&self) -> Vec<BlockSpan> {
        match self.format {
            DocumentFormat::Markdown => block_source_map(&self.text),
            DocumentFormat::Xml => tei_block_source_map(&self.text),
        }
    }

    /// The task-marker offsets for the live buffer (Markdown only; empty for XML).
    pub fn task_offsets(&self) -> Vec<usize> {
        match self.format {
            DocumentFormat::Markdown => task_marker_offsets(&self.text),
            DocumentFormat::Xml => Vec::new(),
        }
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
    /// Whether the reading view may turn this block into a live editor. A mapped
    /// block that isn't editable still shows its source range (so it can be
    /// re-rendered after a neighbour's edit shifts offsets), but typing into it is
    /// left to the code view until its stage lands. See [`kind_is_editable`].
    pub editable: bool,
}

impl BlockSpan {
    pub(crate) fn new(id: usize, kind: &'static str, start: usize, end: usize) -> Self {
        Self {
            id,
            kind,
            start,
            end,
            editable: kind_is_editable(kind),
        }
    }
}

/// Whether a block of this kind can be edited inline in the reading view today.
/// Kept deliberately small and grown one stage at a time: a kind only turns
/// editable once its DOM→source round-trip is implemented and tested, so an
/// un-handled block never risks corrupting the source. Everything else stays
/// read-only in the reader and editable through the code view.
pub fn kind_is_editable(kind: &str) -> bool {
    matches!(kind, "paragraph" | "heading")
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
                        let end = trim_block_end(markdown, range.start, range.end);
                        spans.push(BlockSpan::new(next_id, kind, range.start, end));
                        next_id += 1;
                    }
                }
                depth += 1;
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            // Thematic breaks and raw HTML blocks are leaf events with no
            // Start/End pair, but they are still top-level blocks worth mapping.
            Event::Rule if depth == 0 => {
                let end = trim_block_end(markdown, range.start, range.end);
                spans.push(BlockSpan::new(next_id, "rule", range.start, end));
                next_id += 1;
            }
            Event::Html(_) if depth == 0 => {
                let end = trim_block_end(markdown, range.start, range.end);
                spans.push(BlockSpan::new(next_id, "html_block", range.start, end));
                next_id += 1;
            }
            _ => {}
        }
    }

    spans
}

/// Shrink a block's source range to exclude its trailing whitespace and newlines,
/// which pulldown-cmark folds into the block's range but which are really the
/// separators *between* blocks. Keeping them out means an edit that replaces the
/// range with the block's content leaves the surrounding blank lines intact, so
/// paragraph spacing survives editing.
fn trim_block_end(source: &str, start: usize, end: usize) -> usize {
    let bytes = source.as_bytes();
    let mut end = end.min(source.len());
    while end > start && matches!(bytes.get(end - 1), Some(b'\n' | b'\r' | b' ' | b'\t')) {
        end -= 1;
    }
    end
}

/// Byte offset of the state character — the ` `, `x`, or `X` between the
/// brackets — of every list task marker in `markdown`, in document order. An
/// interactive checkbox in the reading view toggles this one ASCII byte, which
/// checks or unchecks the item without shifting any other offset. The Nth offset
/// corresponds to the Nth rendered list checkbox, so the frontend addresses a
/// checkbox purely by its position.
///
/// Only genuine list task markers are mapped: `into_offset_iter()` runs on the
/// raw Markdown, where a `[ ]` inside a table cell is plain text, not a
/// `TaskListMarker` event (the table-cell checkbox is synthesized later in the
/// render pipeline). The frontend excludes table-cell checkboxes to match.
pub fn task_marker_offsets(markdown: &str) -> Vec<usize> {
    let parser = Parser::new_ext(markdown, markdown_options()).into_offset_iter();
    let mut offsets = Vec::new();
    for (event, range) in parser {
        if matches!(event, Event::TaskListMarker(_)) {
            if let Some(offset) = task_marker_state_offset(markdown, range.start, range.end) {
                offsets.push(offset);
            }
        }
    }
    offsets
}

/// Locate the state character inside a `[ ]` / `[x]` task marker whose source
/// spans `[start, end)`. Returns the byte offset of the character between the
/// brackets, or `None` if the slice does not hold a well-formed `[?]` marker.
fn task_marker_state_offset(markdown: &str, start: usize, end: usize) -> Option<usize> {
    let slice = markdown.get(start..end)?;
    let open = slice.find('[')?;
    if slice.as_bytes().get(open + 2) != Some(&b']') {
        return None;
    }
    let inner = start + open + 1;
    match markdown.as_bytes().get(inner)? {
        b' ' | b'x' | b'X' => Some(inner),
        _ => None,
    }
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
