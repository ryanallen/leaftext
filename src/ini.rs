//! INI configuration files: the reader, and the dialect it reads.
//!
//! There is no INI standard — dialects disagree about comment characters, end-of-line comments, duplicate keys, quoting, escapes and the delimiter — so one dialect is picked here and written down. It is [EditorConfig](https://spec.editorconfig.org/index.html)'s, which is the nearest thing to a specification for an INI-shaped file:
//!
//! - A comment is `;` or `#` first on its line. Nowhere else, because an end-of-line comment is the one difference that silently eats data: a Windows path, a color, a URL and a password all carry `#` mid-value. Leading whitespace before the marker is allowed, since a comment indented under a section is common and a line whose first visible character is a marker is never a key.
//! - A comment is stepped over rather than stripped, exactly as [`crate::data`]'s JSON reader does, so every range below stays an offset into the string the reader was handed.
//! - `[name]` alone on a line opens a section. Keys written before the first one go in an unnamed block at the top, which is what a `.gitconfig`-shaped file puts its first lines in.
//! - The first `=` splits, and the key and the value are trimmed. A `:` delimiter is Python's `configparser` rather than the Windows original, and taking both makes any URL-valued key ambiguous.
//! - Nothing is unescaped, unquoted or joined: the value is the bytes as typed. That is this app's standing answer for every format — show the file as written — and it is what makes each range provable and each save byte-identical to what was read.
//! - A repeated key draws twice, in order, which [`crate::data`]'s renderer already does.
//! - A line that is none of these is drawn as a value with no name, so a file that turns out not to be INI at all still puts every word it holds on the page rather than rendering empty.
//!
//! The tree it answers is [`crate::data`]'s, so the page is the one a JSON file already draws: a section is a heading and its scalar keys are the label-and-value list under it. What differs is the labels — a key is drawn as it was typed, because `font_size` is a name somebody chose rather than a phrase to sentence-case.

use crate::*;

/// Parse an INI file into the shared data tree. Every scalar carries the exact byte range of its value, which is what [`crate::editing`] splices when the value is typed into.
pub(crate) fn parse_ini(source: &str) -> DataNode {
    let mut root: Vec<(String, DataNode)> = Vec::new();
    let mut section: Option<(String, Vec<(String, DataNode)>)> = None;

    let mut offset = 0usize;
    for line in source.split_inclusive('\n') {
        let start = offset;
        offset += line.len();

        let body = line.trim_end_matches(['\n', '\r']);
        let trimmed = body.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }

        if let Some(name) = section_name(trimmed) {
            if let Some((name, pairs)) = section.take() {
                root.push((name, DataNode::mapping(pairs)));
            }
            section = Some((name.to_string(), Vec::new()));
            continue;
        }

        let (key, value) = read_pair(body, start);
        match &mut section {
            Some((_, pairs)) => pairs.push((key, value)),
            None => root.push((key, value)),
        }
    }

    if let Some((name, pairs)) = section.take() {
        root.push((name, DataNode::mapping(pairs)));
    }

    DataNode::mapping(root)
}

/// The name a `[section]` line opens, or `None` when the line is not one. The whole trimmed line has to be the brackets and their contents — a value like `pattern = [a-z]` is a key, not a section.
fn section_name(trimmed: &str) -> Option<&str> {
    let inner = trimmed.strip_prefix('[')?.strip_suffix(']')?;
    Some(inner.trim())
}

/// One `key = value` line, as a key and a scalar carrying the value's own byte range. `line` is the line without its ending, and `start` is where it begins in the source, so every range is an offset into the whole file.
///
/// A line with no `=` names nothing, so it is drawn as a value with an empty key: the words are on the page, which is what "show the file as written" means for a file that turns out not to be INI at all. Giving it the line as its key instead would lose it, because the renderer skips a field whose value says nothing.
fn read_pair(line: &str, start: usize) -> (String, DataNode) {
    let (key, at, value) = match line.find('=') {
        Some(split) => {
            let raw = &line[split + 1..];
            let value = raw.trim();
            let at = start + split + 1 + (raw.len() - raw.trim_start().len());
            (line[..split].trim().to_string(), at, value)
        }
        None => {
            let value = line.trim();
            let at = start + (line.len() - line.trim_start().len());
            (String::new(), at, value)
        }
    };
    // An empty value has no bytes to show and none to replace, so it carries no range — the same answer `data.rs` gives a bare `key:`.
    let span = (!value.is_empty()).then(|| at..at + value.len());
    (key, DataNode::scalar(value.to_string(), span))
}

/// Render an INI string to `(title, html, blocks)`, through the renderer JSON and YAML already share. The keys keep their own spelling: the shared helper would draw `url` as "Link" and `id` as "ID", which are three wrong words on a page whose whole point is the file as written.
pub(crate) fn render_ini_document(
    source: &str,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    render_data_document(&parse_ini(source), fallback_title, LabelStyle::AsWritten)
}

/// The block source map for an INI string, matching what [`render_ini_document`] stamps inline. One call, so the map and the page can never be two answers.
pub(crate) fn ini_block_source_map(source: &str) -> Vec<BlockSpan> {
    render_ini_document(source, None).2
}
