//! The editing model: the source-backed document buffer and the Markdown block
//! source map in-viewer editing stands on. Rust owns the editable text; the
//! webview is the interaction shell.

use crate::*;

/// Reading-view undo entries kept per document; each is a full buffer snapshot.
const UNDO_STACK_CAP: usize = 200;

/// A document open for editing: Rust's authoritative copy of the source text.
/// `text` is the live buffer; `saved` is the last-written text, so dirty is
/// just `text != saved`. `version` increments on save so the file watcher can
/// tell our own saves from external edits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditableDocument {
    pub path: PathBuf,
    pub format: DocumentFormat,
    text: String,
    saved: String,
    version: u64,
    /// Buffer snapshots taken before each reading-view edit, newest last. The
    /// browser's native undo can't cross the re-render an edit triggers, so
    /// inline-edit undo lives here. Code-view typing is not snapshotted — the
    /// editor's own undo covers it.
    undo_stack: Vec<String>,
}

impl EditableDocument {
    /// Start an editing session for `path` seeded with `contents`, which is
    /// both the live buffer and the saved baseline (so it opens clean).
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

    /// Revert the most recent reading-view edit; returns whether anything was
    /// undone. A successful save clears the stack, so undo only covers edits
    /// made since the last saved baseline.
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

    /// Replace the whole buffer — the code view's resync path, when a splice left
    /// the two copies disagreeing. Returns whether the dirty state changed.
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
    /// the saved baseline (so dirty clears), reader-edit undo history resets,
    /// and the version advances.
    pub fn mark_saved(&mut self) {
        self.saved = self.text.clone();
        self.undo_stack.clear();
        self.version += 1;
    }

    /// Adopt `contents` as a fresh baseline without a save — used when
    /// live-reload accepts an external change into a clean buffer.
    pub fn adopt_external(&mut self, contents: String) {
        self.saved = contents.clone();
        self.text = contents;
    }

    /// Splice `replacement` into the buffer over byte range `[start, end)` —
    /// the core of source-anchored in-viewer editing. The range is clamped to
    /// the buffer and snapped outward to char boundaries so a bad offset can't
    /// panic or corrupt UTF-8; start past end is an insertion at `start`.
    /// Returns whether the dirty state changed.
    pub fn replace_range(&mut self, start: usize, end: usize, replacement: &str) -> bool {
        self.splice(start, end, replacement, true)
    }

    /// Like [`replace_range`] but records no undo snapshot — for the auto-saving
    /// checkbox path, which is deliberately not undoable.
    pub fn replace_range_without_undo(
        &mut self,
        start: usize,
        end: usize,
        replacement: &str,
    ) -> bool {
        self.splice(start, end, replacement, false)
    }

    fn splice(&mut self, start: usize, end: usize, replacement: &str, record_undo: bool) -> bool {
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
        let before = record_undo.then(|| self.text.clone());
        self.text.replace_range(start..end, replacement);
        if let Some(before) = before {
            self.push_undo(before);
        }
        was_dirty != self.is_dirty()
    }

    /// Splice over a range given in UTF-16 code units — what a JavaScript string
    /// index counts — recording no undo, like the code-view typing it serves.
    ///
    /// The page sends the edit rather than the buffer (4 MB of IPC per typing pause
    /// otherwise), and its offsets are UTF-16. Byte offsets diverge from those the
    /// moment the text has a diacritic or an emoji in it, so the conversion happens
    /// here, against the buffer being spliced.
    pub fn splice_utf16_without_undo(
        &mut self,
        start: usize,
        removed: usize,
        inserted: &str,
    ) -> bool {
        let (start_byte, end_byte) = self.byte_range_for_utf16(start, removed);
        self.splice(start_byte, end_byte, inserted, false)
    }

    /// Byte offsets for `[start, start + removed)` counted in UTF-16 code units.
    fn byte_range_for_utf16(&self, start: usize, removed: usize) -> (usize, usize) {
        let end_units = start.saturating_add(removed);
        let mut units = 0usize;
        let mut start_byte = None;
        for (byte, ch) in self.text.char_indices() {
            if start_byte.is_none() && units >= start {
                start_byte = Some(byte);
            }
            if units >= end_units {
                return (start_byte.unwrap_or(byte), byte);
            }
            units += ch.len_utf16();
        }
        (start_byte.unwrap_or(self.text.len()), self.text.len())
    }

    /// The buffer's length in UTF-16 code units, so the page can prove the two
    /// copies still agree after a splice.
    pub fn utf16_len(&self) -> usize {
        self.text.chars().map(char::len_utf16).sum()
    }

    /// Toggle the `index`-th task-list marker by flipping the state byte
    /// between its brackets (`[ ]` ⇄ `[x]`). The offset is recomputed from the
    /// live buffer, and one ASCII byte replaces another so no offsets shift.
    /// Returns whether dirty changed; out-of-range is a no-op. Markdown only.
    pub fn toggle_task(&mut self, index: usize) -> bool {
        self.flip_task(index, true)
    }

    /// Like [`toggle_task`] but records no undo snapshot — for the auto-saving
    /// checkbox path, which is deliberately not undoable.
    pub fn toggle_task_without_undo(&mut self, index: usize) -> bool {
        self.flip_task(index, false)
    }

    fn flip_task(&mut self, index: usize, record_undo: bool) -> bool {
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
        self.splice(
            offset,
            offset + 1,
            if currently_checked { " " } else { "x" },
            record_undo,
        )
    }

    /// The block source map for the live buffer: Markdown via pulldown-cmark
    /// offsets, XML via roxmltree node ranges, JSON and YAML via their readers.
    /// The reading view attaches these to rendered blocks so an edit knows which
    /// source range to splice. JSON and YAML blocks are mapped but never
    /// editable — see [`crate::data`] for why.
    pub fn block_source_map(&self) -> Vec<BlockSpan> {
        match self.format {
            DocumentFormat::Markdown => block_source_map(&self.text),
            DocumentFormat::Xml => xml_block_source_map(&self.text),
            DocumentFormat::Json => json_block_source_map(&self.text),
            DocumentFormat::Yaml => yaml_block_source_map(&self.text),
        }
    }

    /// The task-marker offsets for the live buffer (Markdown only; the data
    /// formats have no task lists).
    pub fn task_offsets(&self) -> Vec<usize> {
        match self.format {
            DocumentFormat::Markdown => task_marker_offsets(&self.text),
            DocumentFormat::Xml | DocumentFormat::Json | DocumentFormat::Yaml => Vec::new(),
        }
    }
}

/// One top-level block, tying a stable id and kind to its exact source byte
/// range. Produced from pulldown-cmark's `into_offset_iter()`, so Markdown
/// only; TEI/XML has no equivalent offset map here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlockSpan {
    pub id: usize,
    pub kind: &'static str,
    pub start: usize,
    pub end: usize,
    /// Whether the reading view may turn this block into a live editor. A
    /// non-editable mapped block still carries its range (so it re-renders when
    /// a neighbor's edit shifts offsets) but is edited via the code view.
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

/// Whether a block of this kind can be edited inline in the reading view. Only
/// kinds with a tested DOM→source round-trip qualify; everything else is edited
/// through the code view.
pub fn kind_is_editable(kind: &str) -> bool {
    matches!(kind, "paragraph" | "heading")
}

/// Map every top-level block of `markdown` to its source byte range. Nested
/// blocks (list items, table cells, inline spans) fold into their enclosing
/// top-level block's range.
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
            // Rules and raw HTML blocks are leaf events (no Start/End pair) but
            // still top-level blocks.
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

/// Trim a block's trailing whitespace/newlines, which pulldown-cmark folds into
/// the range but are really separators between blocks. Excluding them keeps the
/// surrounding blank lines intact when an edit replaces the range.
fn trim_block_end(source: &str, start: usize, end: usize) -> usize {
    let bytes = source.as_bytes();
    let mut end = end.min(source.len());
    while end > start && matches!(bytes.get(end - 1), Some(b'\n' | b'\r' | b' ' | b'\t')) {
        end -= 1;
    }
    end
}

/// Byte offset of the state char (` `/`x`/`X` between the brackets) of every
/// list task marker, in document order. The Nth offset is the Nth rendered
/// checkbox, so the frontend addresses one by position. Only genuine list
/// markers map — a `[ ]` in a table cell is plain text, not a `TaskListMarker`.
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
