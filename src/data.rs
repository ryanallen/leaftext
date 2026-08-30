//! JSON and YAML: their readers, and the reading renderer the two share.
//!
//! Both formats are ordered trees of mappings, sequences and scalars, so both parse into one [`DataNode`] tree and render through [`crate::xml`]'s shape rules and label helpers — a sitemap and the JSON beside it read alike.
//!
//! **A block's range is a promise.** Outside Markdown, the reading view turns a block carrying `data-src-*` into a *source* editor: it shows the raw slice those offsets cut and splices what is typed back over exactly that range. An end offset off by a byte corrupts the file, so a range is stamped only where it is proved — every JSON node, and the YAML scalars whose own bytes are checked against the source ([`scalar_span`]). Everything else is edited in the code view.
//!
//! `BlockSpan::editable` stays false regardless; it gates the Markdown WYSIWYG path, which the `data_*` block kinds also keep these blocks out of.

use crate::*;
use std::ops::Range;
use yaml_rust2::parser::{Event as YamlEvent, MarkedEventReceiver, Parser as YamlEventParser};
use yaml_rust2::scanner::{Marker, TScalarStyle};

/// Nesting past this is refused: both readers recurse, so a pathologically deep file would be a stack overflow rather than a rendering problem.
const MAX_PARSE_DEPTH: usize = 128;

// ---------------------------------------------------------------------------
// The shared tree
// ---------------------------------------------------------------------------

/// One node of a parsed data document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DataNode {
    pub(crate) value: DataValue,
    /// The node's byte range in the source, where the reader can vouch for it exactly. `None` is normal and always safe: the block simply renders without `data-src-*`.
    pub(crate) span: Option<Range<usize>>,
}

impl DataNode {
    fn new(value: DataValue, span: Option<Range<usize>>) -> Self {
        Self { value, span }
    }

    /// A node standing in for something that could not be resolved (a YAML alias with no anchor). Renders as nothing, like an empty XML element.
    fn empty() -> Self {
        Self::new(DataValue::Scalar(String::new()), None)
    }

    /// Drop every range in this node and everything under it. A YAML alias is a copy of the anchored value, and the anchor's text is where the anchor is — keeping the ranges gives two blocks one slice, so editing the alias rewrites the anchor's line. Recursive because a collection is `None` at its top while every scalar inside it still holds a real range.
    fn strip_spans(&mut self) {
        self.span = None;
        match &mut self.value {
            DataValue::Scalar(_) => {}
            DataValue::Sequence(items) => items.iter_mut().for_each(DataNode::strip_spans),
            DataValue::Mapping(pairs) => {
                pairs.iter_mut().for_each(|(_, value)| value.strip_spans());
            }
        }
    }

    fn as_scalar(&self) -> Option<&str> {
        match &self.value {
            DataValue::Scalar(text) => Some(text),
            _ => None,
        }
    }
}

/// A node's contents. Mappings keep source order and may repeat a key, because the point is to show the file as written rather than to model it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DataValue {
    /// A single value, decoded for display: a JSON string with its escapes resolved, a number as written, `null` as the empty string.
    Scalar(String),
    Sequence(Vec<DataNode>),
    Mapping(Vec<(String, DataNode)>),
}

/// Why a file could not be read, phrased for someone looking at the file.
#[derive(Debug, Clone)]
pub(crate) struct DataError {
    message: String,
    /// 1-based line the problem was found on, when the reader knows it. YAML leaves this `None` — the scanner's own message already names line and column.
    line: Option<usize>,
}

impl DataError {
    /// The error as a reading-view message, naming the position when known — a malformed data file is usually a typo worth locating.
    fn to_html(&self, format: &str) -> String {
        let mut text = self.message.clone();
        if let Some(line) = self.line {
            text.push_str(&format!(" (line {line})"));
        }
        format!(
            "<p><strong>{format} parse error.</strong> {}</p>",
            encode_text(&text)
        )
    }
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/// Parse JSON into the shared tree, every node carrying an exact byte range.
///
/// Lenient about comments and a trailing comma, because the job is to show a file rather than certify it — `tsconfig.json` and editor settings carry both.
pub(crate) fn parse_json(source: &str) -> Result<DataNode, DataError> {
    let mut reader = JsonReader {
        source,
        bytes: source.as_bytes(),
        position: 0,
    };
    reader.skip_trivia();
    let node = reader.value(0)?;
    reader.skip_trivia();
    if reader.position < reader.bytes.len() {
        return Err(reader.error("unexpected content after the document"));
    }
    Ok(node)
}

struct JsonReader<'a> {
    source: &'a str,
    bytes: &'a [u8],
    position: usize,
}

impl<'a> JsonReader<'a> {
    fn error(&self, message: &str) -> DataError {
        DataError {
            message: message.to_string(),
            line: Some(line_of(self.source, self.position)),
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }

    fn rest(&self) -> &'a str {
        &self.source[self.position..]
    }

    /// Skip whitespace, comments, and a leading byte order mark. Stepped over rather than stripped: every range this reader produces is an offset into the string it was handed, and removing three bytes would shift all of them. [`read_source`] already takes the mark off a file, but JSON also arrives from the code view.
    fn skip_trivia(&mut self) {
        loop {
            while matches!(self.peek(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
                self.position += 1;
            }
            let rest = self.rest();
            if rest.starts_with('\u{feff}') {
                self.position += '\u{feff}'.len_utf8();
            } else if rest.starts_with("//") {
                self.position += rest.find('\n').unwrap_or(rest.len());
            } else if rest.starts_with("/*") {
                self.position += rest[2..]
                    .find("*/")
                    .map(|end| end + 4)
                    .unwrap_or(rest.len());
            } else {
                return;
            }
        }
    }

    fn value(&mut self, depth: usize) -> Result<DataNode, DataError> {
        if depth > MAX_PARSE_DEPTH {
            return Err(self.error("nested too deeply to read"));
        }
        let start = self.position;
        let value = match self.peek() {
            Some(b'{') => self.object(depth)?,
            Some(b'[') => self.array(depth)?,
            Some(b'"') => DataValue::Scalar(self.string()?),
            Some(b't') => {
                self.keyword("true")?;
                DataValue::Scalar("true".to_string())
            }
            Some(b'f') => {
                self.keyword("false")?;
                DataValue::Scalar("false".to_string())
            }
            Some(b'n') => {
                self.keyword("null")?;
                // Nothing to show, like an empty XML element.
                DataValue::Scalar(String::new())
            }
            Some(_) => DataValue::Scalar(self.number()?),
            None => return Err(self.error("the document ended early")),
        };
        Ok(DataNode::new(value, Some(start..self.position)))
    }

    fn object(&mut self, depth: usize) -> Result<DataValue, DataError> {
        self.position += 1;
        let mut pairs: Vec<(String, DataNode)> = Vec::new();
        loop {
            self.skip_trivia();
            match self.peek() {
                Some(b'}') => {
                    self.position += 1;
                    return Ok(DataValue::Mapping(pairs));
                }
                None => return Err(self.error("this object is never closed")),
                Some(b'"') => {}
                Some(_) => return Err(self.error("expected a quoted key")),
            }
            let key = self.string()?;
            self.skip_trivia();
            if self.peek() != Some(b':') {
                return Err(self.error("expected ':' after the key"));
            }
            self.position += 1;
            self.skip_trivia();
            let value = self.value(depth + 1)?;
            pairs.push((key, value));
            self.skip_trivia();
            match self.peek() {
                Some(b',') => self.position += 1,
                Some(b'}') => {
                    self.position += 1;
                    return Ok(DataValue::Mapping(pairs));
                }
                _ => return Err(self.error("expected ',' or '}' after the value")),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<DataValue, DataError> {
        self.position += 1;
        let mut items: Vec<DataNode> = Vec::new();
        loop {
            self.skip_trivia();
            match self.peek() {
                Some(b']') => {
                    self.position += 1;
                    return Ok(DataValue::Sequence(items));
                }
                None => return Err(self.error("this array is never closed")),
                _ => {}
            }
            items.push(self.value(depth + 1)?);
            self.skip_trivia();
            match self.peek() {
                Some(b',') => self.position += 1,
                Some(b']') => {
                    self.position += 1;
                    return Ok(DataValue::Sequence(items));
                }
                _ => return Err(self.error("expected ',' or ']' after the value")),
            }
        }
    }

    fn string(&mut self) -> Result<String, DataError> {
        self.position += 1;
        let mut out = String::new();
        loop {
            match self.peek() {
                None => return Err(self.error("this string is never closed")),
                Some(b'"') => {
                    self.position += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.position += 1;
                    self.escape(&mut out)?;
                }
                Some(_) => {
                    // Copy one whole character, so multi-byte text survives.
                    let Some(character) = self.rest().chars().next() else {
                        return Err(self.error("this string is never closed"));
                    };
                    out.push(character);
                    self.position += character.len_utf8();
                }
            }
        }
    }

    fn escape(&mut self, out: &mut String) -> Result<(), DataError> {
        // Step over a whole character: `\🌀` is not an escape, and advancing one byte would leave the position inside the emoji.
        let Some(escaped) = self.rest().chars().next() else {
            return Err(self.error("the document ended inside an escape"));
        };
        self.position += escaped.len_utf8();
        let character = match escaped {
            '"' => '"',
            '\\' => '\\',
            '/' => '/',
            'b' => '\u{8}',
            'f' => '\u{c}',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            'u' => return self.unicode_escape(out),
            _ => return Err(self.error("unknown string escape")),
        };
        out.push(character);
        Ok(())
    }

    /// Decode `\uXXXX`, pairing a leading surrogate with the one that follows so characters outside the basic plane survive.
    fn unicode_escape(&mut self, out: &mut String) -> Result<(), DataError> {
        let first = self.hex4()?;
        let code = if (0xD800..0xDC00).contains(&first) && self.rest().starts_with("\\u") {
            let resume = self.position;
            self.position += 2;
            let second = self.hex4()?;
            if (0xDC00..0xE000).contains(&second) {
                0x1_0000 + ((first - 0xD800) << 10) + (second - 0xDC00)
            } else {
                // Not a trailing surrogate after all; leave it to be read next.
                self.position = resume;
                first
            }
        } else {
            first
        };
        // A lone surrogate is not a character. Show the replacement rather than refuse the file — the rest of it is still worth reading.
        out.push(char::from_u32(code).unwrap_or('\u{fffd}'));
        Ok(())
    }

    fn hex4(&mut self) -> Result<u32, DataError> {
        let end = self.position + 4;
        let Some(digits) = self.source.get(self.position..end) else {
            return Err(self.error("truncated '\\u' escape"));
        };
        // `from_str_radix` would accept a leading sign, so `\u+12f` would slip through as 0x12f. Four hex digits means four hex digits.
        if !digits.chars().all(|digit| digit.is_ascii_hexdigit()) {
            return Err(self.error("'\\u' escape is not four hex digits"));
        }
        let Ok(code) = u32::from_str_radix(digits, 16) else {
            return Err(self.error("'\\u' escape is not four hex digits"));
        };
        self.position = end;
        Ok(code)
    }

    /// A number, kept as the source wrote it. Nothing here converts to `f64`, so a long literal displays with every digit it was given.
    fn number(&mut self) -> Result<String, DataError> {
        let start = self.position;
        if self.peek() == Some(b'-') {
            self.position += 1;
        }
        if self.digits() == 0 {
            return Err(self.error("expected a value"));
        }
        if self.peek() == Some(b'.') {
            self.position += 1;
            if self.digits() == 0 {
                return Err(self.error("expected digits after the decimal point"));
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.position += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.position += 1;
            }
            if self.digits() == 0 {
                return Err(self.error("expected digits in the exponent"));
            }
        }
        Ok(self.source[start..self.position].to_string())
    }

    fn digits(&mut self) -> usize {
        let start = self.position;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.position += 1;
        }
        self.position - start
    }

    fn keyword(&mut self, word: &str) -> Result<(), DataError> {
        if self.rest().starts_with(word) {
            self.position += word.len();
            Ok(())
        } else {
            Err(self.error("unknown keyword"))
        }
    }
}

/// The 1-based line number `offset` falls on, for a parse error's message.
fn line_of(source: &str, offset: usize) -> usize {
    // Counting bytes rather than slicing: an offset that is past the end, or in the middle of a character, must still produce a line number.
    source
        .bytes()
        .take(offset)
        .filter(|byte| *byte == b'\n')
        .count()
        + 1
}

// ---------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------

/// Parse YAML into the shared tree, driving the parser's event stream so the tree keeps source order and byte ranges. A stream holding several documents becomes a sequence of them.
pub(crate) fn parse_yaml(source: &str) -> Result<DataNode, DataError> {
    let mut builder = YamlBuilder::new(source);
    let mut parser = YamlEventParser::new_from_str(source);
    parser.load(&mut builder, true).map_err(|error| DataError {
        message: error.to_string(),
        // The scanner's message already names the line and column, and its own index counts characters rather than bytes.
        line: None,
    })?;
    builder.finish()
}

/// Marker indices from the YAML scanner count *characters*; every block range in the app is a byte offset. Events arrive in source order, so one forward-only cursor converts them without building a table over the whole file.
struct CharCursor<'a> {
    source: &'a str,
    characters: usize,
    bytes: usize,
}

impl<'a> CharCursor<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            characters: 0,
            bytes: 0,
        }
    }

    fn byte_of(&mut self, character_index: usize) -> usize {
        // Ordered input never rewinds, but a restart costs one scan and keeps this correct if the parser ever hands back an earlier marker.
        if character_index < self.characters {
            self.characters = 0;
            self.bytes = 0;
        }
        while self.characters < character_index {
            let Some(character) = self.source[self.bytes..].chars().next() else {
                break;
            };
            self.bytes += character.len_utf8();
            self.characters += 1;
        }
        self.bytes
    }
}

/// A scalar held back one event, so the marker of whatever follows can bound its source text (see [`scalar_span`]).
struct PendingScalar {
    text: String,
    style: TScalarStyle,
    anchor: usize,
    start: usize,
}

/// A collection being built, innermost last.
enum Frame {
    Sequence {
        items: Vec<DataNode>,
        anchor: usize,
        start: usize,
    },
    Mapping {
        pairs: Vec<(String, DataNode)>,
        /// The key waiting for its value; `None` means the next node is a key.
        key: Option<String>,
        anchor: usize,
        start: usize,
    },
}

struct YamlBuilder<'a> {
    source: &'a str,
    cursor: CharCursor<'a>,
    stack: Vec<Frame>,
    documents: Vec<DataNode>,
    /// Nodes carrying an `&anchor`, so a later `*alias` can be resolved to one.
    anchors: HashMap<usize, DataNode>,
    pending: Option<PendingScalar>,
    /// Set when nesting passes [`MAX_PARSE_DEPTH`]; reported by `finish`.
    too_deep: bool,
}

impl<'a> YamlBuilder<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            cursor: CharCursor::new(source),
            stack: Vec::new(),
            documents: Vec::new(),
            anchors: HashMap::new(),
            pending: None,
            too_deep: false,
        }
    }

    fn finish(mut self) -> Result<DataNode, DataError> {
        if self.too_deep {
            return Err(DataError {
                message: "nested too deeply to read".to_string(),
                line: None,
            });
        }
        self.flush(self.source.len());
        Ok(match self.documents.len() {
            0 => DataNode::new(DataValue::Mapping(Vec::new()), None),
            1 => self.documents.remove(0),
            // Several documents in one stream read as a list of them.
            _ => DataNode::new(DataValue::Sequence(self.documents), None),
        })
    }

    /// Turn the held-back scalar into a node, now that `bound` — where the next event began — limits how far its text can reach.
    fn flush(&mut self, bound: usize) {
        let Some(pending) = self.pending.take() else {
            return;
        };
        let span = scalar_span(
            self.source,
            pending.start,
            bound,
            &pending.text,
            pending.style,
        );
        let node = DataNode::new(DataValue::Scalar(pending.text), span);
        self.remember(pending.anchor, &node);
        self.place(node);
    }

    fn remember(&mut self, anchor: usize, node: &DataNode) {
        if anchor != 0 {
            self.anchors.insert(anchor, node.clone());
        }
    }

    /// File a finished node: into the open collection, or as a document root.
    fn place(&mut self, node: DataNode) {
        match self.stack.last_mut() {
            None => self.documents.push(node),
            Some(Frame::Sequence { items, .. }) => items.push(node),
            Some(Frame::Mapping { pairs, key, .. }) => match key.take() {
                // A mapping alternates key, value, key, value.
                None => *key = Some(node.as_scalar().unwrap_or_default().to_string()),
                Some(name) if name == "<<" => merge_into(pairs, node),
                Some(name) => pairs.push((name, node)),
            },
        }
    }

    /// Close the innermost collection at `bound` and file it.
    fn close(&mut self, bound: usize) {
        let Some(frame) = self.stack.pop() else {
            return;
        };
        let (value, anchor, start) = match frame {
            Frame::Sequence {
                items,
                anchor,
                start,
            } => (DataValue::Sequence(items), anchor, start),
            Frame::Mapping {
                pairs,
                anchor,
                start,
                ..
            } => (DataValue::Mapping(pairs), anchor, start),
        };
        let _ = (start, bound);
        // No range for a collection: nothing here can prove where one *ends* — the closing marker points at whatever token followed it — and a guessed end is a file the source editor splices an edit into the wrong part of.
        let node = DataNode::new(value, None);
        self.remember(anchor, &node);
        self.place(node);
    }
}

impl MarkedEventReceiver for YamlBuilder<'_> {
    fn on_event(&mut self, event: YamlEvent, mark: Marker) {
        let at = self.cursor.byte_of(mark.index());
        // Every event bounds the scalar held back from the one before it.
        self.flush(at);
        match event {
            YamlEvent::Scalar(text, style, anchor, _) => {
                self.pending = Some(PendingScalar {
                    text,
                    style,
                    anchor,
                    start: at,
                });
            }
            YamlEvent::Alias(id) => {
                let mut node = self
                    .anchors
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(DataNode::empty);
                node.strip_spans();
                self.place(node);
            }
            YamlEvent::SequenceStart(anchor, _) => {
                if self.stack.len() >= MAX_PARSE_DEPTH {
                    self.too_deep = true;
                    return;
                }
                self.stack.push(Frame::Sequence {
                    items: Vec::new(),
                    anchor,
                    start: at,
                });
            }
            YamlEvent::MappingStart(anchor, _) => {
                if self.stack.len() >= MAX_PARSE_DEPTH {
                    self.too_deep = true;
                    return;
                }
                self.stack.push(Frame::Mapping {
                    pairs: Vec::new(),
                    key: None,
                    anchor,
                    start: at,
                });
            }
            YamlEvent::SequenceEnd | YamlEvent::MappingEnd => self.close(at),
            _ => {}
        }
    }
}

/// YAML's merge key (`<<: *defaults`) means "those pairs, here", so splice them in rather than showing a field named `<<`. Pairs already written win, which is what merging means.
fn merge_into(pairs: &mut Vec<(String, DataNode)>, node: DataNode) {
    match node.value {
        DataValue::Mapping(inherited) => {
            for (key, value) in inherited {
                if !pairs.iter().any(|(existing, _)| existing == &key) {
                    pairs.push((key, value));
                }
            }
        }
        // `<<: [*a, *b]` merges several, earliest winning.
        DataValue::Sequence(sources) => {
            for source in sources {
                merge_into(pairs, source);
            }
        }
        DataValue::Scalar(_) => {}
    }
}

/// The source range of a scalar, when it can be *proved*: the text lies in `start..bound` followed by whitespace or structure, so the slice is trimmed and held against the value the parser reported. A block or folded scalar carries an indicator and indentation its value does not, so neither matches and each correctly gets `None` — an approximate range is worse than none.
fn scalar_span(
    source: &str,
    start: usize,
    bound: usize,
    text: &str,
    style: TScalarStyle,
) -> Option<Range<usize>> {
    let quote = match style {
        TScalarStyle::Plain => None,
        TScalarStyle::SingleQuoted => Some('\''),
        TScalarStyle::DoubleQuoted => Some('"'),
        _ => return None,
    };
    let slice = source.get(start..bound.min(source.len()))?;
    let trimmed = slice.trim_end();
    let Some(mark) = quote else {
        // A range of width nothing is not a range. `key:` with no value has no text to show or replace, and splicing `x` into the gap writes `key:x` — one scalar, not a key and a value.
        return (trimmed == text && !trimmed.is_empty()).then(|| start..start + trimmed.len());
    };
    // The same equality, against the quotes the value is written in: an escape, a doubled quote and a fold across lines each make the raw bytes differ from the text, so every one of them fails this and keeps `None` without being looked for. A quoted empty has two bytes to show and replace, so it is a range where a bare `key:` is not.
    let inner = trimmed.strip_prefix(mark)?.strip_suffix(mark)?;
    (inner == text).then(|| start..start + trimmed.len())
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/// Render a JSON string to `(title, html, blocks)`. `fallback_title` (normally the file name) heads the page when the document names no title of its own.
pub(crate) fn render_json_document(
    source: &str,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    match parse_json(source) {
        Ok(root) => render_data_document(&root, fallback_title),
        Err(error) => (None, error.to_html("JSON"), Vec::new()),
    }
}

/// Render a YAML string to `(title, html, blocks)`, as [`render_json_document`] does for JSON.
pub(crate) fn render_yaml_document(
    source: &str,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    match parse_yaml(source) {
        Ok(root) => render_data_document(&root, fallback_title),
        Err(error) => (None, error.to_html("YAML"), Vec::new()),
    }
}

/// The block source map for a JSON string, matching what [`render_json_document`] stamps inline.
pub(crate) fn json_block_source_map(source: &str) -> Vec<BlockSpan> {
    render_json_document(source, None).2
}

/// The block source map for a YAML string.
pub(crate) fn yaml_block_source_map(source: &str) -> Vec<BlockSpan> {
    render_yaml_document(source, None).2
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

struct DataCtx {
    out: String,
    blocks: Vec<BlockSpan>,
    next_block_id: usize,
    seen: HashMap<String, usize>,
}

impl DataCtx {
    fn new() -> Self {
        Self {
            out: String::new(),
            blocks: Vec::new(),
            next_block_id: 0,
            seen: HashMap::new(),
        }
    }

    fn push(&mut self, markup: &str) {
        self.out.push_str(markup);
    }

    /// Record a block and return the `data-*` attributes for its opening tag. A node with no proven range still gets an id and a kind, just no `data-src-*` — and so no entry in the map, which indexes source ranges.
    fn block_attrs(&mut self, kind: &'static str, span: Option<Range<usize>>) -> String {
        let id = self.next_block_id;
        self.next_block_id += 1;
        match span {
            Some(range) => {
                self.blocks
                    .push(BlockSpan::new(id, kind, range.start, range.end));
                format!(
                    " data-block-id=\"{id}\" data-src-start=\"{}\" data-src-end=\"{}\" data-block-kind=\"{kind}\"",
                    range.start, range.end
                )
            }
            None => format!(" data-block-id=\"{id}\" data-block-kind=\"{kind}\""),
        }
    }

    fn unique_slug(&mut self, text: &str) -> String {
        let base = tei_slugify(text);
        let count = self.seen.entry(base.clone()).or_insert(0);
        let slug = if *count == 0 {
            base.clone()
        } else {
            format!("{base}-{count}")
        };
        *count += 1;
        slug
    }

    /// `borrowed` where the words are the file's name standing in for a title the document has not got, which is a heading the app lets the reader rename the file by.
    fn heading(&mut self, level: usize, text: &str, span: Option<Range<usize>>, borrowed: bool) {
        // A YAML mapping may be keyed by a collection rather than a name, which leaves nothing to head the section with. An empty heading is worse than none, so the section's contents just follow what came before.
        if text.trim().is_empty() {
            return;
        }
        let id = self.unique_slug(text);
        let mut attrs = self.block_attrs("data_heading", span);
        if borrowed {
            attrs.push_str(BORROWED_TITLE_ATTR);
        }
        self.push(&format!(
            "<h{level}{attrs} id=\"{}\">{}</h{level}>\n",
            encode_double_quoted_attribute(&id),
            encode_text(text)
        ));
    }
}

/// Render a parsed tree: the title heading, then the root's contents.
fn render_data_document(
    root: &DataNode,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    let mut ctx = DataCtx::new();

    // A title-ish key at the root titles the document, and is then left out of the body so it isn't said twice.
    let title_key = title_key_of(root);
    let title_pair = title_key.as_deref().and_then(|key| match &root.value {
        DataValue::Mapping(pairs) => pairs.iter().find(|(name, _)| name.as_str() == key),
        _ => None,
    });
    let title = title_pair
        .and_then(|(_, node)| node.as_scalar())
        .and_then(plain_document_title);

    // The heading is the value's only appearance on the page, so it carries the value's own range and the reader edits it there. A heading standing in for a title the document has not got names no value, so it carries none.
    let title_span = title
        .is_some()
        .then(|| title_pair.and_then(|(_, node)| node.span.clone()))
        .flatten();
    let heading = title
        .clone()
        .or_else(|| fallback_title.and_then(plain_document_title));
    if let Some(heading) = heading {
        ctx.heading(1, &heading, title_span, title.is_none());
    }

    match &root.value {
        DataValue::Mapping(pairs) => {
            let skip = title.is_some().then_some(title_key).flatten();
            let kept: Vec<(String, DataNode)> = pairs
                .iter()
                .filter(|(name, _)| Some(name) != skip.as_ref())
                .cloned()
                .collect();
            render_mapping(&kept, &mut ctx, 0);
        }
        _ => render_node(root, &mut ctx, 0),
    }

    (title, ctx.out, ctx.blocks)
}

/// The root key whose value titles the document, in [`LABEL_TAGS`] order.
fn title_key_of(root: &DataNode) -> Option<String> {
    let DataValue::Mapping(pairs) = &root.value else {
        return None;
    };
    for label in LABEL_TAGS {
        let found = pairs.iter().find(|(name, node)| {
            name.eq_ignore_ascii_case(label)
                && node.as_scalar().is_some_and(|text| !text.trim().is_empty())
        });
        if let Some((name, _)) = found {
            return Some(name.clone());
        }
    }
    None
}

fn render_node(node: &DataNode, ctx: &mut DataCtx, depth: usize) {
    match &node.value {
        DataValue::Mapping(pairs) => render_mapping(pairs, ctx, depth),
        DataValue::Sequence(items) => render_sequence(items, ctx, depth),
        DataValue::Scalar(text) => render_prose(text, node.span.clone(), ctx),
    }
}

/// Render a mapping: consecutive scalar keys collapse into one field list, and anything holding more structure becomes a section.
fn render_mapping(pairs: &[(String, DataNode)], ctx: &mut DataCtx, depth: usize) {
    let mut index = 0;
    while index < pairs.len() {
        if pairs[index].1.as_scalar().is_some() {
            let mut end = index;
            while end < pairs.len() && pairs[end].1.as_scalar().is_some() {
                end += 1;
            }
            render_fields(&pairs[index..end], ctx);
            index = end;
            continue;
        }
        let (key, value) = &pairs[index];
        // Past the depth limit, stop sectioning and say what is left as prose, as the XML renderer does.
        if depth >= MAX_DEPTH {
            render_prose(&flatten_text(value), value.span.clone(), ctx);
        } else {
            ctx.heading((2 + depth).min(6), &friendly_label(key), None, false);
            render_node(value, ctx, depth + 1);
        }
        index += 1;
    }
}

/// Render a sequence: uniform records become a table, all-scalar items become a list, and anything else renders in turn, each named by its own title key when it has one.
fn render_sequence(items: &[DataNode], ctx: &mut DataCtx, depth: usize) {
    if let Some(columns) = table_columns(items) {
        render_table(items, &columns, ctx);
        return;
    }
    if !items.is_empty() && items.iter().all(|item| item.as_scalar().is_some()) {
        render_list(items, ctx);
        return;
    }
    for item in items {
        if depth >= MAX_DEPTH {
            render_prose(&flatten_text(item), item.span.clone(), ctx);
            continue;
        }
        // Only a record that names itself gets a heading; there is nothing truthful to call the others, and an invented "Item 3" is noise.
        if let Some(label) = record_label(item) {
            ctx.heading((2 + depth).min(6), &label, None, false);
        }
        render_node(item, ctx, depth + 1);
    }
}

/// A record's own name, from a title-ish key holding a scalar.
fn record_label(node: &DataNode) -> Option<String> {
    let key = title_key_of(node)?;
    let DataValue::Mapping(pairs) = &node.value else {
        return None;
    };
    pairs
        .iter()
        .find(|(name, _)| name == &key)
        .and_then(|(_, value)| value.as_scalar())
        .and_then(plain_document_title)
}

/// Render scalar-valued keys as one label/value list, skipping the ones that say nothing (a `null`, an empty string) as the XML renderer skips empty elements.
fn render_fields(pairs: &[(String, DataNode)], ctx: &mut DataCtx) {
    let mut rows = String::new();
    for (key, node) in pairs {
        let Some(text) = node.as_scalar().filter(|text| !text.trim().is_empty()) else {
            continue;
        };
        let attrs = ctx.block_attrs("data_field", node.span.clone());
        rows.push_str(&format!(
            "<dt>{}</dt><dd{attrs}>{}</dd>\n",
            encode_text(&friendly_label(key)),
            linkify(text)
        ));
    }
    if rows.is_empty() {
        return;
    }
    ctx.push(&format!("<dl class=\"data-fields\">\n{rows}</dl>\n"));
}

/// Render a scalar as a paragraph.
fn render_prose(text: &str, span: Option<Range<usize>>, ctx: &mut DataCtx) {
    if text.trim().is_empty() {
        return;
    }
    let attrs = ctx.block_attrs("data_prose", span);
    ctx.push(&format!("<p{attrs}>{}</p>\n", linkify(text)));
}

/// Render a run of scalars as a bulleted list.
fn render_list(items: &[DataNode], ctx: &mut DataCtx) {
    let values: Vec<&str> = items
        .iter()
        .filter_map(|item| item.as_scalar())
        .filter(|text| !text.trim().is_empty())
        .collect();
    if values.is_empty() {
        return;
    }
    // The range has to cover what the block actually shows. If an item was left out for saying nothing — a `null` sitting between two values — the range would reach across source the list never rendered, so it gets none.
    let span = (values.len() == items.len())
        .then(|| enclosing_span(items))
        .flatten();
    let attrs = ctx.block_attrs("data_list", span);
    let mut html = format!("<ul class=\"data-list\"{attrs}>\n");
    for value in values {
        html.push_str(&format!("<li>{}</li>\n", linkify(value)));
    }
    html.push_str("</ul>\n");
    ctx.push(&html);
}

/// Whether `items` is a run of repeated records worth rendering as a table, and if so its columns. A record qualifies when it is a flat mapping of short scalars — the same test the XML renderer applies to repeated elements.
fn table_columns(items: &[DataNode]) -> Option<Vec<(String, String)>> {
    if items.len() < 2 {
        return None;
    }
    let mut columns: Vec<(String, String)> = Vec::new();
    for item in items {
        let DataValue::Mapping(pairs) = &item.value else {
            return None;
        };
        if pairs.is_empty() {
            return None;
        }
        for (key, value) in pairs {
            let text = value.as_scalar()?;
            if text.chars().count() > MAX_TABLE_CELL_CHARS {
                return None;
            }
            if !columns.iter().any(|(name, _)| name == key) {
                columns.push((key.clone(), friendly_label(key)));
            }
        }
        if columns.len() > MAX_TABLE_COLUMNS {
            return None;
        }
    }
    // A single column is just a list; leave it to the field renderer.
    (columns.len() >= 2).then_some(columns)
}

/// Render records as one table, one row each.
fn render_table(items: &[DataNode], columns: &[(String, String)], ctx: &mut DataCtx) {
    let attrs = ctx.block_attrs("data_table", enclosing_span(items));
    let mut html = format!("<table class=\"data-table\"{attrs}>\n<thead><tr>");
    for (_, label) in columns {
        html.push_str(&format!("<th>{}</th>", encode_text(label)));
    }
    html.push_str("</tr></thead>\n<tbody>\n");
    for item in items {
        let DataValue::Mapping(pairs) = &item.value else {
            continue;
        };
        html.push_str("<tr>");
        for (key, label) in columns {
            let value = pairs
                .iter()
                .find(|(name, _)| name == key)
                .and_then(|(_, node)| node.as_scalar())
                .map(linkify)
                .unwrap_or_default();
            html.push_str(&format!(
                "<td data-leaf-col=\"{}\">{value}</td>",
                encode_double_quoted_attribute(label)
            ));
        }
        html.push_str("</tr>\n");
    }
    html.push_str("</tbody>\n</table>\n");
    ctx.push(&html);
}

/// One range covering every node in `items`, and `None` unless *all* of them have one. All-or-nothing is the point: skipping the rangeless items would cover only part of the block, so the source editor would show one item and splice the edit over that alone while the reader believed they had edited the list. A YAML flow sequence hits it exactly — `[windows, macos]` proves `macos` but not `windows,`.
fn enclosing_span(items: &[DataNode]) -> Option<Range<usize>> {
    let mut ranges = Vec::with_capacity(items.len());
    for item in items {
        ranges.push(item.span.clone()?);
    }
    let start = ranges.iter().map(|range| range.start).min()?;
    let end = ranges.iter().map(|range| range.end).max()?;
    Some(start..end)
}

/// Every scalar under a node, joined — what a subtree says once it is too deep to keep sectioning.
fn flatten_text(node: &DataNode) -> String {
    let mut parts: Vec<String> = Vec::new();
    collect_text(node, &mut parts);
    parts.join(" ")
}

fn collect_text(node: &DataNode, parts: &mut Vec<String>) {
    match &node.value {
        DataValue::Scalar(text) => {
            if !text.trim().is_empty() {
                parts.push(text.trim().to_string());
            }
        }
        DataValue::Sequence(items) => {
            for item in items {
                collect_text(item, parts);
            }
        }
        DataValue::Mapping(pairs) => {
            for (_, value) in pairs {
                collect_text(value, parts);
            }
        }
    }
}
