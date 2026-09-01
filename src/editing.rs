//! The editing model: the source-backed document buffer and the Markdown block source map in-viewer editing stands on. Rust owns the editable text; the webview is the interaction shell.

use crate::*;
use std::ops::Range;

/// Reading-view undo entries kept per document; each is a full buffer snapshot.
const UNDO_STACK_CAP: usize = 200;

/// A document open for editing: Rust's authoritative copy of the source text. `text` is the live buffer; `saved` is the last-written text, so dirty is just `text != saved`. `version` increments on save so the file watcher can tell our own saves from external edits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditableDocument {
    pub path: PathBuf,
    pub format: DocumentFormat,
    /// How the file was spelled when it was read — encoding, and whether it had a byte order mark — spent again on every save so writing a document never changes how it sits on disk.
    pub spelling: SourceSpelling,
    /// True until this document has a file. It wears a name regardless, to be a tab; this is what stops a save from writing to that name.
    pub untitled: bool,
    text: String,
    saved: String,
    version: u64,
    /// Buffer snapshots taken before each reading-view edit, newest last. The browser's native undo can't cross the re-render an edit triggers, so inline-edit undo lives here. Code-view typing is not snapshotted — the editor's own undo covers it.
    undo_stack: Vec<String>,
    /// What each undo displaced, newest last, so a press too many can be walked forward again. A fresh undoable edit drops it: the future those snapshots belonged to no longer exists.
    redo_stack: Vec<String>,
    /// The archive this buffer's text came out of, where the document is a package rather than a file somebody typed. `None` for the nine text formats, which are their own file.
    package: Option<PackageBuffer>,
}

/// A package behind an edit buffer: the archive as it was read, and which member of it the buffer's text is.
///
/// The buffer holds one member because one splice, one undo stack and one save are what the whole editing model is; a save puts that member back and copies every other one byte for byte, which is why a chart, a theme, a tracked change and a macro survive an edit nothing here understands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageBuffer {
    pub bytes: Vec<u8>,
    pub member: String,
}

impl EditableDocument {
    /// Start an editing session for `path` seeded with `contents`, which is both the live buffer and the saved baseline (so it opens clean). The spelling travels with the contents: it is a fact about the file, and the save spends it.
    pub fn new(path: PathBuf, contents: SourceText) -> Self {
        let format = DocumentFormat::from_path(&path);
        let SourceText { text, spelling } = contents;
        Self {
            path,
            format,
            spelling,
            untitled: false,
            saved: text.clone(),
            text,
            version: 0,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            package: None,
        }
    }

    /// The same, over a package: the buffer's text is the member named, and the archive travels with it so a save can put that member back into the file it came out of.
    pub fn over_package(path: PathBuf, contents: SourceText, package: PackageBuffer) -> Self {
        Self {
            package: Some(package),
            ..Self::new(path, contents)
        }
    }

    /// The archive behind this buffer, where the document is a package.
    pub fn package(&self) -> Option<&PackageBuffer> {
        self.package.as_ref()
    }

    /// An empty document with no file behind it. `path` is the name it wears until the first save asks where it goes.
    pub fn untitled(path: PathBuf) -> Self {
        Self {
            untitled: true,
            ..Self::new(path, SourceText::utf8(String::new()))
        }
    }

    /// Give a never-saved document its file. The format follows the name, since whoever chose where it goes also chose what it is.
    pub fn adopt_path(&mut self, path: PathBuf) {
        self.format = DocumentFormat::from_path(&path);
        self.path = path;
        self.untitled = false;
    }

    /// Record `before` as an undo point if the buffer actually changed, keeping the stack bounded. A new edit ends whatever future the last undo left standing.
    fn push_undo(&mut self, before: String) {
        if before == self.text {
            return;
        }
        self.redo_stack.clear();
        self.undo_stack.push(before);
        if self.undo_stack.len() > UNDO_STACK_CAP {
            self.undo_stack.remove(0);
        }
    }

    /// Revert the most recent reading-view edit; returns whether anything was undone. A successful save clears the stack, so undo only covers edits made since the last saved baseline. What it displaces is kept, so the press can be walked forward again.
    pub fn undo(&mut self) -> bool {
        match self.undo_stack.pop() {
            Some(previous) => {
                let displaced = std::mem::replace(&mut self.text, previous);
                self.redo_stack.push(displaced);
                true
            }
            None => false,
        }
    }

    /// Restore the version the last undo displaced; returns whether anything came back. The text it displaces in turn goes back on the undo stack, so the two walk one history in either direction.
    pub fn redo(&mut self) -> bool {
        match self.redo_stack.pop() {
            Some(later) => {
                let displaced = std::mem::replace(&mut self.text, later);
                // No cap check: this only ever puts back an entry undo took off, so the stack cannot grow past where it already was.
                self.undo_stack.push(displaced);
                true
            }
            None => false,
        }
    }

    /// Whether there is a reading-view edit to undo.
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    /// Whether an undo left a version to bring back.
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// The live buffer contents.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Replace the whole buffer — the code view's resync path, when a splice left the two copies disagreeing. Returns whether the dirty state changed.
    pub fn set_text(&mut self, text: String) -> bool {
        let was_dirty = self.is_dirty();
        self.text = text;
        was_dirty != self.is_dirty()
    }

    /// Whether the buffer differs from what was last written to disk.
    pub fn is_dirty(&self) -> bool {
        self.text != self.saved
    }

    /// The text as it was last written to disk. What the saved session carries beside an unsaved buffer, so the next launch can tell whether the file is still the one those edits were made against.
    pub fn saved_text(&self) -> &str {
        &self.saved
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    /// Record that the current buffer was written to disk: the buffer becomes the saved baseline (so dirty clears), reader-edit history resets in both directions, and the version advances.
    pub fn mark_saved(&mut self) {
        self.saved = self.text.clone();
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.version += 1;
    }

    /// Adopt `contents` as a fresh baseline without a save — used when live-reload accepts an external change into a clean buffer. The spelling comes along, since an outside edit may have re-spelled the file.
    pub fn adopt_external(&mut self, contents: SourceText) {
        let SourceText { text, spelling } = contents;
        self.spelling = spelling;
        self.saved = text.clone();
        self.text = text;
        // Both histories are snapshots of a document this one has replaced, so stepping into either would put somebody else's file back.
        self.undo_stack.clear();
        self.redo_stack.clear();
    }

    /// Splice `replacement` into the buffer over byte range `[start, end)` — the core of source-anchored in-viewer editing. The range is clamped to the buffer and snapped outward to char boundaries so a bad offset can't panic or corrupt UTF-8; start past end is an insertion at `start`. Returns whether the dirty state changed.
    pub fn replace_range(&mut self, start: usize, end: usize, replacement: &str) -> bool {
        self.splice(start, end, replacement, true)
    }

    /// Rewrite a sheet cell to say `text`, as one undoable edit over the cell's own element.
    ///
    /// The words a workbook shows are usually not in the sheet at all — they are in `xl/sharedStrings.xml`, with the cell holding an index — so there is no run of words in this buffer to splice. What is spliced is the cell element, rewritten as an inline string, which reaches the same outcome without opening the shared table and so leaves a string two cells share exactly as it was. Answers whether anything was written: a range that is not a cell element is left alone rather than quietly turned into one.
    pub fn replace_sheet_cell(&mut self, start: usize, end: usize, text: &str) -> bool {
        // Only a workbook has cells written this way, and asking the format first is what stops a Markdown note that happens to hold the characters of a cell element being rewritten as one.
        if self.format != DocumentFormat::Xlsx {
            return false;
        }
        let Some(element) = self.text.get(start..end) else {
            return false;
        };
        let Some(rewritten) = crate::office::sheet_cell_saying(element, text) else {
            return false;
        };
        // The answer is whether the cell was rewritten, never `splice`'s own — that one reports the dirty flag moving, which a buffer already dirty from an earlier edit never does. Reading it here told the caller nothing had been written, and its fallback spliced the words over the cell this call had just put there.
        self.splice(start, end, &rewritten, true);
        true
    }

    /// Like `replace_range` but records no undo snapshot — for the auto-saving checkbox path, which is deliberately not undoable, and for every splice of a typing run after its first, so a run that paused four times is still one press of undo.
    pub fn replace_range_without_undo(
        &mut self,
        start: usize,
        end: usize,
        replacement: &str,
    ) -> bool {
        self.splice(start, end, replacement, false)
    }

    /// Reorder sibling blocks by moving the text of slot `from` to slot `to`.
    ///
    /// `ranges` are the source ranges of one run of siblings, in document order. The texts rotate through the slots; whatever sits *between* the slots — blank lines in Markdown, indentation and commas in a structured file — never moves. That is what makes one routine safe for every format: the separators are the part a naive cut-and-paste gets wrong.
    ///
    /// Refuses (returns `false`, buffer untouched) unless the ranges are sorted, non-overlapping, inside the buffer and on char boundaries — a drifted map must not be allowed to shred a file.
    pub fn move_blocks(&mut self, ranges: &[(usize, usize)], from: usize, to: usize) -> bool {
        let count = ranges.len();
        if count < 2 || from >= count || to >= count || from == to {
            return false;
        }
        let mut previous_end = 0;
        for &(start, end) in ranges {
            if start < previous_end || end < start || end > self.text.len() {
                return false;
            }
            if !self.text.is_char_boundary(start) || !self.text.is_char_boundary(end) {
                return false;
            }
            previous_end = end;
        }
        // Which source slot each destination slot takes its text from: remove the dragged one, put it back at `to` — the same arithmetic as moving a tab.
        let mut order: Vec<usize> = (0..count).collect();
        let moved = order.remove(from);
        order.insert(to, moved);

        let mut rebuilt = String::new();
        for (slot, &source) in order.iter().enumerate() {
            let (source_start, source_end) = ranges[source];
            rebuilt.push_str(&self.text[source_start..source_end]);
            if let Some(&(next_start, _)) = ranges.get(slot + 1) {
                rebuilt.push_str(&self.text[ranges[slot].1..next_start]);
            }
        }
        self.replace_range(ranges[0].0, ranges[count - 1].1, &rebuilt);
        true
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

    /// Splice over a range given in UTF-16 code units — what a JavaScript string index counts — recording no undo, like the code-view typing it serves.
    ///
    /// The page sends the edit rather than the buffer (4 MB of IPC per typing pause otherwise), and its offsets are UTF-16. Byte offsets diverge from those the moment the text has a diacritic or an emoji in it, so the conversion happens here, against the buffer being spliced.
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

    /// The buffer's length in UTF-16 code units, so the page can prove the two copies still agree after a splice.
    pub fn utf16_len(&self) -> usize {
        self.text.chars().map(char::len_utf16).sum()
    }

    /// Toggle the `index`-th task-list marker by flipping the state byte between its brackets (`[ ]` ⇄ `[x]`). The offset is recomputed from the live buffer, and one ASCII byte replaces another so no offsets shift. Returns whether dirty changed; out-of-range is a no-op. Markdown only.
    pub fn toggle_task(&mut self, index: usize) -> bool {
        self.flip_task(index, true)
    }

    /// Like `toggle_task` but records no undo snapshot — for the auto-saving checkbox path, which is deliberately not undoable.
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

    /// The block source map for the live buffer: Markdown via pulldown-cmark offsets, XML via roxmltree node ranges, JSON, YAML and INI via their readers. A packaged format maps nothing, because this buffer holds one member of an archive and a page splicing into it would be writing over the wrong file. The reading view attaches these to rendered blocks so an edit knows which source range to splice. JSON and YAML blocks are mapped but never editable — see `data.rs` for why.
    pub fn block_source_map(&self) -> Vec<BlockSpan> {
        match self.format {
            DocumentFormat::Markdown => block_source_map(&self.text),
            DocumentFormat::Xml => xml_block_source_map(&self.text),
            DocumentFormat::Json => json_block_source_map(&self.text),
            DocumentFormat::Yaml => yaml_block_source_map(&self.text),
            DocumentFormat::Ini => ini_block_source_map(&self.text),
            // Bodies are transfer-encoded, so no rendered block can prove a source range; the code view edits the raw message. A plain text file is one block covering the whole of itself, so a range here would draw the source view a second time inside the reading view.
            DocumentFormat::Eml
            | DocumentFormat::Html
            | DocumentFormat::Text
            // A package's blocks anchor to a member and a range, which this buffer holds one of; until it holds the archive, an office document is read rather than typed into.
            | DocumentFormat::Docx
            | DocumentFormat::Xlsx
            | DocumentFormat::Pptx
            | DocumentFormat::Odt
            | DocumentFormat::Ods
            | DocumentFormat::Odp
            | DocumentFormat::Code => Vec::new(),
        }
    }

    /// Write one table cell, addressed the way the page draws it: the table's own source start, then the row (head row first) and the column, with the width the page drew that row at. Returns whether the cell was proved and written — `false` leaves the buffer untouched, and the caller falls back to rewriting the whole table.
    pub fn replace_table_cell(
        &mut self,
        table_start: usize,
        row: usize,
        column: usize,
        columns: usize,
        text: &str,
        record_undo: bool,
    ) -> bool {
        let Some(span) = self
            .table_source_map()
            .into_iter()
            .find(|table| table.table.start == table_start)
            .and_then(|table| table.writable_cell(row, column, columns))
        else {
            return false;
        };
        let Some(existing) = self.text.get(span.clone()) else {
            return false;
        };
        let replacement = table_cell_replacement(existing, text);
        self.splice(span.start, span.end, &replacement, record_undo);
        true
    }

    /// Where every cell of every table in the live buffer sits, so a one-cell edit splices one cell (Markdown only; the data formats have no GFM tables).
    pub fn table_source_map(&self) -> Vec<TableMap> {
        match self.format {
            DocumentFormat::Markdown => table_source_map(&self.text),
            DocumentFormat::Xml
            | DocumentFormat::Json
            | DocumentFormat::Yaml
            | DocumentFormat::Eml
            | DocumentFormat::Html
            | DocumentFormat::Text
            | DocumentFormat::Ini
            | DocumentFormat::Docx
            | DocumentFormat::Xlsx
            | DocumentFormat::Pptx
            | DocumentFormat::Odt
            | DocumentFormat::Ods
            | DocumentFormat::Odp
            | DocumentFormat::Code => Vec::new(),
        }
    }

    /// The task-marker offsets for the live buffer (Markdown only; the data formats have no task lists).
    pub fn task_offsets(&self) -> Vec<usize> {
        match self.format {
            DocumentFormat::Markdown => task_marker_offsets(&self.text),
            DocumentFormat::Xml
            | DocumentFormat::Json
            | DocumentFormat::Yaml
            | DocumentFormat::Eml
            | DocumentFormat::Html
            | DocumentFormat::Text
            | DocumentFormat::Ini
            | DocumentFormat::Docx
            | DocumentFormat::Xlsx
            | DocumentFormat::Pptx
            | DocumentFormat::Odt
            | DocumentFormat::Ods
            | DocumentFormat::Odp
            | DocumentFormat::Code => Vec::new(),
        }
    }
}

/// One top-level block, tying a stable id and kind to its exact source byte range. Produced from pulldown-cmark's `into_offset_iter()`, so Markdown only; TEI/XML has no equivalent offset map here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlockSpan {
    pub id: usize,
    pub kind: &'static str,
    pub start: usize,
    pub end: usize,
    /// Whether the reading view may turn this block into a live editor. A non-editable mapped block still carries its range (so it re-renders when a neighbor's edit shifts offsets) but is edited via the code view.
    pub editable: bool,
    /// Whether a footnote was written inside this block, so what the page draws is not all of its source: the renderer lifts the footnote out to the foot of the page. Anything writing this block back has to put those lines on again.
    pub holds_footnote: bool,
}

impl BlockSpan {
    pub(crate) fn new(id: usize, kind: &'static str, start: usize, end: usize) -> Self {
        Self {
            id,
            kind,
            start,
            end,
            editable: kind_is_editable(kind),
            holds_footnote: false,
        }
    }
}

/// Whether a block of this kind can be edited inline in the reading view. Only kinds with a tested DOM→source round-trip qualify; everything else is edited through the code view.
pub fn kind_is_editable(kind: &str) -> bool {
    matches!(kind, "paragraph" | "heading")
}

/// Map every top-level block of `markdown` to its source byte range. Nested blocks (list items, table cells, inline spans) fold into their enclosing top-level block's range.
///
/// A leading frontmatter block is taken off first, because the renderer takes it off too and draws it from its own parse — so it has no element the page can pair a span with. Left in, its fences read as a rule and a setext heading, and the page drops every range in the document rather than trust a mapping it cannot line up. The ranges stay the file's: the body's own offset goes back on at the end.
///
/// The list comes out in the order the page draws the blocks, not the order the file was written in: a footnote definition is written mid-file and drawn at the foot of the page, so its span moves to the end by the renderer's own rule.
///
/// A footnote written inside a quote or a list item is the one nested block with a span of its own, because the renderer lifts it out and draws it at the foot as a top-level element like any other. Left out, the page has one element more than it has blocks and drops every range in the document, taking the whole note read-only. The block it was written inside is marked — see [`BlockSpan::holds_footnote`].
pub fn block_source_map(markdown: &str) -> Vec<BlockSpan> {
    let body = match crate::markdown::split_leading_frontmatter(markdown) {
        Some((_, rest)) => rest,
        None => markdown,
    };
    let offset = markdown.len() - body.len();
    let parser = Parser::new_ext(body, markdown_options()).into_offset_iter();
    let mut spans = Vec::new();
    let mut depth = 0usize;
    let mut definitions: Vec<(usize, String)> = Vec::new();
    let mut references: Vec<String> = Vec::new();
    // The top-level block currently open, so a footnote written inside one can mark it.
    let mut container: Option<usize> = None;

    for (event, range) in parser {
        match &event {
            Event::Start(tag) => {
                if depth == 0 {
                    container = None;
                    if let Some(kind) = block_kind(tag) {
                        let end = trim_block_end(body, range.start, range.end);
                        if !block_reaches_the_page_as_nothing(kind, &body[range.start..end]) {
                            spans.push(BlockSpan::new(spans.len(), kind, range.start, end));
                            container = Some(spans.len() - 1);
                            if let Tag::FootnoteDefinition(name) = tag {
                                definitions.push((spans.len() - 1, name.to_string()));
                            }
                        }
                    }
                } else if let Tag::FootnoteDefinition(name) = tag {
                    // Nested, and still drawn at the foot as a top-level element, so it needs a block of its own or the page has one element more than it has blocks. The end also drops the container's own markers, so the span is the definition's line and nothing of the quote around it.
                    let end = trim_nested_block_end(body, range.start, range.end);
                    spans.push(BlockSpan::new(
                        spans.len(),
                        "footnote_definition",
                        range.start,
                        end,
                    ));
                    definitions.push((spans.len() - 1, name.to_string()));
                    if let Some(index) = container {
                        spans[index].holds_footnote = true;
                    }
                }
                depth += 1;
            }
            Event::End(_) => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    container = None;
                }
            }
            // Rules and raw HTML blocks are leaf events (no Start/End pair) but still top-level blocks.
            Event::Rule if depth == 0 => {
                let end = trim_block_end(body, range.start, range.end);
                spans.push(BlockSpan::new(spans.len(), "rule", range.start, end));
            }
            Event::Html(_) if depth == 0 => {
                let end = trim_block_end(body, range.start, range.end);
                spans.push(BlockSpan::new(spans.len(), "html_block", range.start, end));
            }
            // A reference numbers its footnote wherever it sits, nested ones included, exactly as the render pass numbers them.
            Event::FootnoteReference(name) => references.push(name.to_string()),
            _ => {}
        }
    }

    let mut spans =
        crate::markdown::relocate_footnote_definition_blocks(spans, &definitions, &references);
    // The id is the block's place in this list, so it is stamped after the move rather than at the parse.
    for (id, span) in spans.iter_mut().enumerate() {
        span.id = id;
        span.start += offset;
        span.end += offset;
    }
    spans
}

/// Whether this block draws nothing on the page, so no element can carry its span — a comment, a `script` or a `style`. One span the page cannot pair with drops every range in the document, which is why a leading frontmatter block is taken off above too. What the sanitizer removes is `markdown`'s to say, never a second list here.
fn block_reaches_the_page_as_nothing(kind: &str, source: &str) -> bool {
    kind == "html_block" && crate::markdown::html_block_renders_to_no_element(source)
}

/// One GFM table found in a document, with a proved byte range for every part an edit can splice.
#[derive(Debug, Clone, PartialEq)]
pub struct TableMap {
    pub table: Range<usize>,
    pub head: TableRowMap,
    /// The `| --- | ---: |` line. It fires no event; this is the gap between the head row and the first body row, or the table's own end when there is no body row.
    pub delimiter: Range<usize>,
    /// The parser's, not re-read from the colons.
    pub alignments: Vec<Alignment>,
    pub rows: Vec<TableRowMap>,
    /// Every lone `<!-- … -->` block touching this table. A table can carry one above and one below at once, which is what the two tickets waiting on this want — a schema over it and a formula line under it.
    pub comments: Vec<TableComment>,
    /// False for a table inside a blockquote or a list item, where the continuation markers sit between the rows. A cell write is safe either way; a row or table rewrite is only safe when this is true.
    pub top_level: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableRowMap {
    pub row: Range<usize>,
    pub cells: Vec<TableCellMap>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableCellMap {
    /// The bytes between the pipes, padding included — what a one-cell write replaces.
    pub span: Range<usize>,
    /// False for a cell GFM invented to fill a short row. It has no bytes of its own, and two of them can share one offset, so nothing may be written there.
    pub written: bool,
}

/// A lone `<!-- … -->` block touching a table, above or below it. The grammar inside stays with whoever owns it; this only proves where it sits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableComment {
    pub span: Range<usize>,
    /// The text between `<!--` and `-->`, unparsed.
    pub inner: String,
    /// Whether it sits above the table or below it.
    pub before: bool,
}

impl TableMap {
    /// The head row as row 0 and the body rows after it, so the page can name a cell by the position it draws.
    pub fn row(&self, row: usize) -> Option<&TableRowMap> {
        match row.checked_sub(1) {
            None => Some(&self.head),
            Some(body) => self.rows.get(body),
        }
    }

    /// The bytes one cell may be written over, or `None` where the map cannot prove them: a row or column that is not there, a cell GFM invented to fill a short row, or a row whose width disagrees with the `columns` the caller drew.
    pub fn writable_cell(&self, row: usize, column: usize, columns: usize) -> Option<Range<usize>> {
        let row = self.row(row)?;
        if row.cells.len() != columns {
            return None;
        }
        let cell = row.cells.get(column)?;
        cell.written.then(|| cell.span.clone())
    }
}

/// Map every GFM table in `markdown` to the byte ranges an edit can splice: the table, its head row, its delimiter row, every body row, every cell, and a lone HTML comment touching it.
///
/// Built on demand — a cell edit asks for it — rather than on the path to first paint: a document of nothing but tables is a couple of hundred thousand ranges, which is worth one walk when somebody types and worth nothing when they only read. One walk answers all of it; there is no second pass over the raw source, because the parser already carries a range for every cell, escaped pipes included.
///
/// Frontmatter is taken off first and its offset put back on, so the ranges are the file's — the same bargain [`block_source_map`] makes, and what makes a range from here comparable with a block's.
pub fn table_source_map(markdown: &str) -> Vec<TableMap> {
    let body = match crate::markdown::split_leading_frontmatter(markdown) {
        Some((_, rest)) => rest,
        None => markdown,
    };
    let offset = markdown.len() - body.len();
    let parser = Parser::new_ext(body, markdown_options()).into_offset_iter();
    let mut tables: Vec<TableMap> = Vec::new();
    let mut comments: Vec<TableComment> = Vec::new();
    let mut depth = 0usize;
    // The table being walked, and the row inside it. Tables never nest, so one of each is enough.
    let mut open: Option<TableMap> = None;
    let mut row: Option<TableRowMap> = None;

    for (event, range) in parser {
        match &event {
            Event::Start(tag) => {
                match tag {
                    Tag::Table(alignments) => {
                        open = Some(TableMap {
                            table: range.clone(),
                            head: TableRowMap {
                                row: range.clone(),
                                cells: Vec::new(),
                            },
                            delimiter: range.start..range.start,
                            alignments: alignments.clone(),
                            rows: Vec::new(),
                            comments: Vec::new(),
                            top_level: depth == 0,
                        });
                    }
                    Tag::TableHead | Tag::TableRow => {
                        row = Some(TableRowMap {
                            row: range.clone(),
                            cells: Vec::new(),
                        });
                    }
                    Tag::TableCell => {
                        if let Some(row) = row.as_mut() {
                            // A cell GFM invented to fill a short row is empty and sits at the row's end offset — two of them share it, so neither is a place anything may be written.
                            let written = !range.is_empty();
                            row.cells.push(TableCellMap {
                                span: range.clone(),
                                written,
                            });
                        }
                    }
                    Tag::HtmlBlock => {
                        if let Some(comment) = html_block_comment(body, range.clone()) {
                            comments.push(comment);
                        }
                    }
                    _ => {}
                }
                depth += 1;
            }
            Event::End(tag) => {
                depth = depth.saturating_sub(1);
                match tag {
                    TagEnd::TableHead => {
                        if let (Some(table), Some(row)) = (open.as_mut(), row.take()) {
                            table.head = row;
                        }
                    }
                    TagEnd::TableRow => {
                        if let (Some(table), Some(row)) = (open.as_mut(), row.take()) {
                            table.rows.push(row);
                        }
                    }
                    TagEnd::Table => {
                        if let Some(mut table) = open.take() {
                            // The delimiter fires no event of its own: it is what lies between the head row and whatever follows it inside the table.
                            let after = table
                                .rows
                                .first()
                                .map(|row| row.row.start)
                                .unwrap_or(table.table.end);
                            table.delimiter = table.head.row.end..after.max(table.head.row.end);
                            tables.push(table);
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    attach_table_comments(body, &mut tables, &comments);
    for table in &mut tables {
        shift_table_map(table, offset);
    }
    tables
}

/// What goes over one cell's bytes, keeping the padding it was written with: the left pipe never moves, and the right one moves only by what the text itself changed. A cell holding nothing but space gets one space each side, which is how the app writes a table it builds.
pub fn table_cell_replacement(existing: &str, text: &str) -> String {
    let text = text.trim();
    let trimmed = existing.trim_start();
    let (lead, trail) = if trimmed.is_empty() {
        (" ", " ")
    } else {
        (
            &existing[..existing.len() - trimmed.len()],
            &existing[existing.trim_end().len()..],
        )
    };
    format!("{lead}{text}{trail}")
}

/// Read an HTML block as a lone comment: it has to be the whole of its block, because a block holding `<!-- x --> text` has a range that is not the comment's and nothing may be written over it.
fn html_block_comment(source: &str, range: Range<usize>) -> Option<TableComment> {
    let text = source.get(range.clone())?.trim_end();
    let inner = text.strip_prefix("<!--")?.strip_suffix("-->")?;
    if inner.contains("-->") {
        return None;
    }
    Some(TableComment {
        span: range.start..range.start + text.len(),
        inner: inner.to_string(),
        before: false,
    })
}

/// Give each table the comment touching it, above or below. Touching means nothing but whitespace between the two — a blank line is allowed, another block is not, since a block between them is what the comment is really about.
fn attach_table_comments(source: &str, tables: &mut [TableMap], comments: &[TableComment]) {
    for table in tables.iter_mut() {
        for comment in comments {
            let gap = if comment.span.end <= table.table.start {
                source.get(comment.span.end..table.table.start)
            } else if table.table.end <= comment.span.start {
                source.get(table.table.end..comment.span.start)
            } else {
                None
            };
            let Some(gap) = gap else { continue };
            if !gap.trim().is_empty() {
                continue;
            }
            let before = comment.span.end <= table.table.start;
            table.comments.push(TableComment {
                before,
                ..comment.clone()
            });
        }
    }
}

/// Put the frontmatter offset back on every range in one table's map.
fn shift_table_map(table: &mut TableMap, offset: usize) {
    if offset == 0 {
        return;
    }
    let shift = |range: &mut Range<usize>| {
        range.start += offset;
        range.end += offset;
    };
    shift(&mut table.table);
    shift(&mut table.delimiter);
    for row in std::iter::once(&mut table.head).chain(table.rows.iter_mut()) {
        shift(&mut row.row);
        for cell in &mut row.cells {
            shift(&mut cell.span);
        }
    }
    for comment in &mut table.comments {
        shift(&mut comment.span);
    }
}

/// Trim a block's trailing whitespace/newlines, which pulldown-cmark folds into the range but are really separators between blocks. Excluding them keeps the surrounding blank lines intact when an edit replaces the range. Same, for a block nested inside a quote: the parser's range runs on past the definition's own line to take in the blank quote line after it, and a `>` left on the end of the span would be spliced away by an edit that only meant to change the words.
fn trim_nested_block_end(source: &str, start: usize, end: usize) -> usize {
    let bytes = source.as_bytes();
    let mut end = end.min(source.len());
    while end > start
        && matches!(
            bytes.get(end - 1),
            Some(b'\n' | b'\r' | b' ' | b'\t' | b'>')
        )
    {
        end -= 1;
    }
    end
}

fn trim_block_end(source: &str, start: usize, end: usize) -> usize {
    let bytes = source.as_bytes();
    let mut end = end.min(source.len());
    while end > start && matches!(bytes.get(end - 1), Some(b'\n' | b'\r' | b' ' | b'\t')) {
        end -= 1;
    }
    end
}

/// Byte offset of the state char (` `/`x`/`X` between the brackets) of every list task marker, in document order. The Nth offset is the Nth rendered checkbox, so the frontend addresses one by position. Only genuine list markers map — a `[ ]` in a table cell is plain text, not a `TaskListMarker`.
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

/// One task in a document, as something outside the app can name it: whether it is checked, and the words it carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskEntry {
    pub checked: bool,
    pub text: String,
}

/// Every list task in document order, so a caller can name one by its position instead of computing a byte offset. The order is `task_marker_offsets`' own, and the same markers: a `[ ]` in a table cell is plain text and is not one.
///
/// The words are the item's own, with its nested lists left out — a task reads as the line somebody wrote, not as everything filed under it.
pub fn task_entries(markdown: &str) -> Vec<TaskEntry> {
    let mut entries: Vec<TaskEntry> = Vec::new();
    // The task being read, and how many list items were open when its marker fired. Only items are counted: a loose list wraps its words in a paragraph, which must not read as nesting, while a nested list's items must.
    let mut open: Option<(bool, String, usize)> = None;
    let mut items = 0usize;
    let close = |open: &mut Option<(bool, String, usize)>, entries: &mut Vec<TaskEntry>| {
        if let Some((checked, text, _)) = open.take() {
            entries.push(TaskEntry {
                checked,
                text: text.split_whitespace().collect::<Vec<_>>().join(" "),
            });
        }
    };
    for event in Parser::new_ext(markdown, markdown_options()) {
        match event {
            Event::Start(Tag::Item) => items += 1,
            Event::TaskListMarker(checked) => {
                close(&mut open, &mut entries);
                open = Some((checked, String::new(), items));
            }
            Event::End(TagEnd::Item) => {
                items = items.saturating_sub(1);
                if open.as_ref().is_some_and(|(_, _, at)| items < *at) {
                    close(&mut open, &mut entries);
                }
            }
            Event::Text(words) | Event::Code(words) => {
                if let Some((_, text, at)) = open.as_mut() {
                    if items == *at {
                        text.push_str(&words);
                    }
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some((_, text, at)) = open.as_mut() {
                    if items == *at {
                        text.push(' ');
                    }
                }
            }
            _ => {}
        }
    }
    close(&mut open, &mut entries);
    entries
}

/// Locate the state character inside a `[ ]` / `[x]` task marker whose source spans `[start, end)`. Returns the byte offset of the character between the brackets, or `None` if the slice does not hold a well-formed `[?]` marker.
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

/// The block kind name for a top-level container tag, or `None` for tags that only ever appear nested inside another block (list items, table parts, inline emphasis, links, images).
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
