//! YAML frontmatter: locating it, parsing it, storing its fields.

use super::normalize_name_key;
use std::collections::HashSet;
use std::ops::Range;
use time::macros::format_description;

/// How many aliases one document may claim. A vault is bounded by construction but a list inside one file is not, and every alias becomes a key in an in-memory index.
pub const MAX_ALIASES: usize = 32;

/// The leading frontmatter block's inner text (between the `---` fences), and where that text begins in the document it was cut from — so a field's range points at the file and not at this copy. A file read from disk has already had its leading byte order mark taken off; this covers text from anywhere else.
#[derive(Debug, Clone, PartialEq)]
pub struct FrontmatterBlock {
    pub body: String,
    pub offset: usize,
}

impl FrontmatterBlock {
    /// A block whose text was separated from its document before it arrived here, so no range can point back at the file. The metadata table takes this path: it draws the fields and never reads a range.
    pub fn detached(body: String) -> Self {
        Self { body, offset: 0 }
    }
}

/// What one field holds. Obsidian's six property types, and the whole vocabulary anything asking a field what it is gets back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldType {
    Text,
    List,
    Number,
    Checkbox,
    Date,
    DateTime,
}

/// One written value: the text a reader should see, whether it arrived in quotes, and the bytes it occupies **as written**.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldValue {
    /// The text with one layer of quotes taken off.
    pub text: String,
    /// Whether that layer was there. It is YAML's own way of saying "text, not a number", and the only way to know whether to put the quotes back when the field is written out.
    pub quoted: bool,
    /// The value as written, quotes included, so replacing this range replaces the whole thing.
    pub range: Range<usize>,
}

/// One frontmatter field. `key` keeps the case the file wrote it in and is compared with [`FrontmatterField::key_is`]. Untrusted; the frontend escapes before the DOM.
#[derive(Debug, Clone, PartialEq)]
pub struct FrontmatterField {
    pub key: String,
    pub key_range: Range<usize>,
    pub kind: FieldType,
    /// The values, in file order: exactly one unless `kind` is [`FieldType::List`], which holds however many the file listed — including one, so a list of one is still a list.
    pub values: Vec<FieldValue>,
}

impl FrontmatterField {
    /// Whether this field is named `name`. Case-insensitive, because the key keeps the case the file gave it and `Author` still has to answer to `author`.
    pub fn key_is(&self, name: &str) -> bool {
        self.key.eq_ignore_ascii_case(name)
    }

    /// The field read as one value — a scalar's text, or a list's first item. Empty for a key that opened a list and got nothing.
    pub fn text(&self) -> &str {
        self.values
            .first()
            .map(|value| value.text.as_str())
            .unwrap_or_default()
    }
}

/// A line in the block that is not a field, and why. Collected rather than raised: a block that half parses still renders, and refusing a line silently is how a nested mapping arrives as two fields nobody typed.
#[derive(Debug, Clone, PartialEq)]
pub struct Refusal {
    pub line: String,
    pub reason: RefusalReason,
    pub range: Range<usize>,
}

/// Why one line was not read as a field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalReason {
    /// An indented `key: value`. Nesting is not part of this format, and splitting on the first colon anyway promotes it to the top level.
    Nested,
    NoColon,
    EmptyKey,
    /// A `- item` with no field above it to attach to.
    OrphanItem,
    /// A key already set higher up the block. Obsidian requires unique names, so the first one wins.
    Duplicate,
}

impl std::fmt::Display for RefusalReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            RefusalReason::Nested => "nested fields are not read",
            RefusalReason::NoColon => "not a `key: value` line",
            RefusalReason::EmptyKey => "nothing before the colon",
            RefusalReason::OrphanItem => "a list item with no field above it",
            RefusalReason::Duplicate => "a key that is already set",
        })
    }
}

/// What parsing a block produced: its fields, and every line the parser would not read. There is no error case, because a block nothing can be made of is already one with no fields and a refusal per line — and a block that half parses has both, which an error could not carry. Neither ever fails the file.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedFrontmatter {
    pub fields: Vec<FrontmatterField>,
    pub refusals: Vec<Refusal>,
}

/// Extract the leading frontmatter block, if any. Detected only when `---` is the first line (after an optional BOM) and a later `---` closes it; a `---` deeper in the document is body content.
///
/// The body is sliced, not rebuilt line by line: every offset inside it has to be an offset into the file, and reassembling with `\n` would drop a byte per line on a CRLF document.
pub fn extract_frontmatter(text: &str) -> Option<FrontmatterBlock> {
    let mark = text.len() - text.strip_prefix('\u{feff}').unwrap_or(text).len();
    let mut at = mark;
    let mut body_start = mark;
    let mut opened = false;
    for line in text[mark..].split_inclusive('\n') {
        // Trailing spaces on a fence are tolerated, and `\r` never reaches the fence test.
        let fence = line.trim_end_matches(['\n', '\r']).trim_end() == "---";
        if !opened {
            if !fence {
                return None;
            }
            opened = true;
            at += line.len();
            body_start = at;
            continue;
        }
        if fence {
            return Some(FrontmatterBlock {
                body: text[body_start..at].to_string(),
                offset: body_start,
            });
        }
        at += line.len();
    }
    // No closing fence: this is not a frontmatter block.
    None
}

/// Strip one layer of matching surrounding quotes from a scalar value, and say whether there was one.
fn strip_quotes(value: &str) -> (&str, bool) {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        (&value[1..value.len() - 1], true)
    } else {
        (value, false)
    }
}

/// The items of the inline-array form `[a, b, c]`: each one's text, its range within `inner` **as written**, and whether it was quoted. Empty items are dropped. The caller has already confirmed the brackets.
fn inline_array_items(inner: &str) -> Vec<(String, Range<usize>, bool)> {
    let mut items = Vec::new();
    let mut at = 0usize;
    for piece in inner.split(',') {
        let start = at;
        at += piece.len() + 1; // past the comma this piece was cut on
        let written = piece.trim();
        if written.is_empty() {
            continue;
        }
        let (value, quoted) = strip_quotes(written);
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let offset = start + (piece.len() - piece.trim_start().len());
        items.push((value.to_string(), offset..offset + written.len(), quoted));
    }
    items
}

/// The three properties Obsidian gives a type to before it looks at any value. They are not guesses, so nothing guesses them — `tags: one` written as a bare string is still a list of one, and the shape of one note's value never decides what the property is.
///
/// Three, not more: Obsidian's own frozen table is `aliases`, `cssclasses` and `tags` and nothing else. Its Publish properties — `publish`, `permalink`, `description`, `image`, `cover` — are inferred there like anything else, so forcing them here would type them differently from the app this is meant to open a vault from.
fn documented_type(key: &str) -> Option<FieldType> {
    const LISTS: [&str; 3] = ["aliases", "cssclasses", "tags"];
    LISTS
        .iter()
        .any(|name| key.eq_ignore_ascii_case(name))
        .then_some(FieldType::List)
}

/// What a scalar is, from the value alone: quoting first, then the value's own shape, then text. One function with no state, so there is one place a type is decided and the sources that override it have somewhere to override.
fn scalar_type(value: &FieldValue) -> FieldType {
    if value.quoted {
        // Quotes are YAML's own way of saying "text", which is why `version: "1.0"` must not become a number.
        return FieldType::Text;
    }
    let text = value.text.as_str();
    if text.eq_ignore_ascii_case("true") || text.eq_ignore_ascii_case("false") {
        FieldType::Checkbox
    } else if is_number(text) {
        FieldType::Number
    } else if is_date_time(text) {
        FieldType::DateTime
    } else if is_date(text) {
        FieldType::Date
    } else {
        FieldType::Text
    }
}

/// Whether the text is a number and nothing else. `f64` alone would take `inf` and `NaN`, which are words a note is far more likely to have meant as words.
fn is_number(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || b"+-.eE".contains(&byte))
        && text.parse::<f64>().is_ok()
}

/// Whether the text is a real calendar date, not merely shaped like one — `2026-13-45` is text.
fn is_date(text: &str) -> bool {
    time::Date::parse(text, format_description!("[year]-[month]-[day]")).is_ok()
}

/// Whether the text is a real date and time. Four shapes, because those are the four Obsidian accepts: the separator is a `T` or a space, and the seconds are optional. Reading only the first would type half a real vault's fields as text.
fn is_date_time(text: &str) -> bool {
    time::PrimitiveDateTime::parse(
        text,
        format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]"),
    )
    .is_ok()
        || time::PrimitiveDateTime::parse(
            text,
            format_description!("[year]-[month]-[day] [hour]:[minute]:[second]"),
        )
        .is_ok()
        || time::PrimitiveDateTime::parse(
            text,
            format_description!("[year]-[month]-[day]T[hour]:[minute]"),
        )
        .is_ok()
        || time::PrimitiveDateTime::parse(
            text,
            format_description!("[year]-[month]-[day] [hour]:[minute]"),
        )
        .is_ok()
}

/// Parse a frontmatter block into fields, plus a refusal for every line that is not one. Ranges are offsets into the text the block was cut from, so something pointing at one field in the source has them already.
pub fn parse_frontmatter(block: &FrontmatterBlock) -> ParsedFrontmatter {
    let mut fields: Vec<FrontmatterField> = Vec::new();
    let mut refusals: Vec<Refusal> = Vec::new();
    // Keys already set, lowercased, so a second one is refused rather than pushed beside the first.
    let mut declared: HashSet<String> = HashSet::new();
    // The most recent `key:` line with an empty value, and that key's range, which a run of `- item` lines attaches to (block-list form).
    let mut list_key: Option<(String, Range<usize>)> = None;
    // Where that key's field landed in `fields`, once an item has actually arrived. A key with no items under it stays out of the list entirely.
    let mut list_at: Option<usize> = None;
    let mut at = block.offset;

    for raw in block.body.split_inclusive('\n') {
        let start = at;
        at += raw.len();
        let line = raw.trim_end_matches(['\n', '\r']);
        let body = line.trim();
        if body.is_empty() || body.starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let body_at = start + indent;
        let mut refuse = |reason| {
            refusals.push(Refusal {
                line: body.to_string(),
                reason,
                range: body_at..body_at + body.len(),
            })
        };

        // A block-list item attaches to the pending list key. A bare `-` is an empty item.
        if let Some(item) = body
            .strip_prefix("- ")
            .or_else(|| (body == "-").then_some(""))
        {
            let Some((key, key_range)) = &list_key else {
                refuse(RefusalReason::OrphanItem);
                continue;
            };
            let written = item.trim();
            if written.is_empty() {
                continue;
            }
            let offset =
                body_at + (body.len() - item.len()) + (item.len() - item.trim_start().len());
            let (text, quoted) = strip_quotes(written);
            let value = FieldValue {
                text: text.trim().to_string(),
                quoted,
                range: offset..offset + written.len(),
            };
            match list_at {
                Some(index) => fields[index].values.push(value),
                None => {
                    list_at = Some(fields.len());
                    fields.push(FrontmatterField {
                        key: key.clone(),
                        key_range: key_range.clone(),
                        kind: FieldType::List,
                        values: vec![value],
                    });
                }
            }
            continue;
        }

        // Otherwise it must be a `key: ...` line. Split on the first colon.
        let Some((key_part, value_part)) = body.split_once(':') else {
            refuse(RefusalReason::NoColon);
            continue;
        };
        let key = key_part.trim();
        if key.is_empty() {
            refuse(RefusalReason::EmptyKey);
            continue;
        }
        if indent > 0 {
            // A nested mapping. Refused rather than promoted: a top-level key sits at column 0, so `  name: Ada` is part of the field above it and never a field of its own.
            list_key = None;
            list_at = None;
            refuse(RefusalReason::Nested);
            continue;
        }
        if !declared.insert(key.to_lowercase()) {
            // Nothing may attach to a key that lost: a following `- item` would otherwise join the first list.
            list_key = None;
            list_at = None;
            refuse(RefusalReason::Duplicate);
            continue;
        }
        let key_at = body_at + (key_part.len() - key_part.trim_start().len());
        let key_range = key_at..key_at + key.len();
        let value = value_part.trim();

        if value.is_empty() {
            // `key:` opens a possible block list; rows come from the items following it.
            list_key = Some((key.to_string(), key_range));
            list_at = None;
            continue;
        }
        list_key = None;
        list_at = None;
        let value_at =
            body_at + key_part.len() + 1 + (value_part.len() - value_part.trim_start().len());

        if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            let values = inline_array_items(inner)
                .into_iter()
                .map(|(text, range, quoted)| FieldValue {
                    text,
                    quoted,
                    // Past the `[`.
                    range: value_at + 1 + range.start..value_at + 1 + range.end,
                })
                .collect();
            fields.push(FrontmatterField {
                key: key.to_string(),
                key_range,
                kind: FieldType::List,
                values,
            });
        } else {
            let (text, quoted) = strip_quotes(value);
            let value = FieldValue {
                text: text.trim().to_string(),
                quoted,
                range: value_at..value_at + value.len(),
            };
            // A list form is a list whatever is in it; only a scalar asks what its own shape says, and only after the properties that already have a documented type.
            let kind = documented_type(key).unwrap_or_else(|| scalar_type(&value));
            fields.push(FrontmatterField {
                key: key.to_string(),
                key_range,
                kind,
                values: vec![value],
            });
        }
    }

    ParsedFrontmatter { fields, refusals }
}

/// One replacement in a document: the bytes to take out, and what goes in their place. A field is changed by splicing over what the parser already located, never by writing the block back — comments, blank lines and the lines the parser refused are not fields, so re-serializing would drop them and reformat a file over one value.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldSplice {
    pub range: Range<usize>,
    pub text: String,
}

impl FieldSplice {
    /// The document with this splice in it.
    pub fn applied_to(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len() + self.text.len());
        out.push_str(&text[..self.range.start]);
        out.push_str(&self.text);
        out.push_str(&text[self.range.end..]);
        out
    }
}

/// The line break the text uses, read off its first one. A CRLF document has to keep its endings, or a spliced-in line is the one line in the block that reads differently.
fn line_break(text: &str) -> &'static str {
    match text.find('\n') {
        Some(at) if text[..at].ends_with('\r') => "\r\n",
        _ => "\n",
    }
}

/// The start of the line `at` sits on, never earlier than `floor`.
fn line_start(text: &str, at: usize, floor: usize) -> usize {
    text[floor..at]
        .rfind('\n')
        .map(|found| floor + found + 1)
        .unwrap_or(floor)
}

/// Past the end of the line `at` sits on, its line break included, never later than `ceiling`.
fn line_end(text: &str, at: usize, ceiling: usize) -> usize {
    text[at..ceiling]
        .find('\n')
        .map(|found| at + found + 1)
        .unwrap_or(ceiling)
}

/// Whether a value has to be quoted to read back as itself. A bare value stays bare: quoting one that never needed it rewrites a line the reader did not ask to change, and would retype a number as text.
fn needs_quotes(value: &str) -> bool {
    const OPENERS: [char; 15] = [
        '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@', '`',
    ];
    value.is_empty()
        || value.starts_with(OPENERS)
        // `-`, `?` and `:` only open something when a space follows, so `-1.5` is still a number.
        || matches!(value, "-" | "?" | ":")
        || value.starts_with("- ")
        || value.starts_with("? ")
        || value.starts_with(": ")
        || value.ends_with(':')
        || value.contains(": ")
        || value.contains(" #")
}

/// Which quote to wrap a value in: the one the value does not itself hold, so the run does not look closed early to any other reader of the file.
fn quote_mark(value: &str) -> char {
    if value.contains('"') && !value.contains('\'') {
        '\''
    } else {
        '"'
    }
}

/// A value as it goes into the file. `kept` is the quote the value already carried, which goes back on — it is YAML's way of saying "text, not a number", and dropping it would retype the field.
fn write_value(value: &str, kept: Option<char>) -> String {
    let mark = match kept {
        Some(mark) if !value.contains(mark) => mark,
        Some(_) => quote_mark(value),
        None if needs_quotes(value) => quote_mark(value),
        None => return value.to_string(),
    };
    format!("{mark}{value}{mark}")
}

/// Where a value goes on a key's own line: everything after the colon, to the end of that line. It is what a key the file opened and put nothing in has to be written over — `tags: []`, or a `tags:` with no items under it — since neither leaves a value range behind to splice.
fn value_slot(text: &str, key_range: &Range<usize>, ceiling: usize) -> Range<usize> {
    let stop = key_range.end
        + text[key_range.end..line_end(text, key_range.end, ceiling)]
            .trim_end_matches(['\n', '\r'])
            .len();
    let start = text[key_range.end..stop]
        .find(':')
        .map(|at| key_range.end + at + 1)
        .unwrap_or(stop);
    start..stop
}

/// A top-level `key:` line holding nothing, and where its key sits. Such a line is neither a field nor a refusal — a key that opens a list and gets no items is left out of both — so setting it writes onto that line, rather than appending a second one the parser would then refuse as a duplicate.
fn empty_key_range(block: &FrontmatterBlock, key: &str) -> Option<Range<usize>> {
    let mut at = block.offset;
    for raw in block.body.split_inclusive('\n') {
        let start = at;
        at += raw.len();
        let line = raw.trim_end_matches(['\n', '\r']);
        if line.starts_with([' ', '\t']) {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if !value.trim().is_empty() || !name.trim_end().eq_ignore_ascii_case(key) {
            continue;
        }
        return Some(start..start + name.trim_end().len());
    }
    None
}

/// Set one field, as a splice over the bytes the parser located — so order, case, comments, quoting and every other field survive the write untouched. A key the document does not have is appended to the block; a document with no block at all gets the fences too.
///
/// `None` when there is nothing to write: a value carrying a line break, which no single-line field can hold, or a change that leaves the document exactly as it was.
pub fn set_field(text: &str, key: &str, value: &str) -> Option<FieldSplice> {
    let value = value.trim();
    if value.contains(['\n', '\r']) {
        return None;
    }
    // The mark the value already carried, so [`write_value`] can put the same one back.
    let kept = extract_frontmatter(text)
        .map(|block| parse_frontmatter(&block))
        .and_then(|parsed| {
            parsed
                .fields
                .iter()
                .find(|field| field.key_is(key))
                .and_then(|field| field.values.first().cloned())
        })
        .filter(|first| first.quoted)
        .and_then(|first| text[first.range].chars().next());
    set_written_field(text, key, &write_value(value, kept))
}

/// Set one field to a value that is already written the way it will sit in the file — brackets, quotes and all. The one path every write takes once its encoding is settled, so where a field goes is decided in one place rather than once per kind of value.
fn set_written_field(text: &str, key: &str, written: &str) -> Option<FieldSplice> {
    let Some(block) = extract_frontmatter(text) else {
        // Past a byte order mark, so the fences are still the first line of the document.
        let start = text.len() - text.strip_prefix('\u{feff}').unwrap_or(text).len();
        let end = line_break(text);
        return Some(FieldSplice {
            range: start..start,
            text: format!("---{end}{key}: {written}{end}---{end}{end}"),
        });
    };
    let parsed = parse_frontmatter(&block);
    let body_end = block.offset + block.body.len();
    let (range, written) = match parsed.fields.iter().find(|field| field.key_is(key)) {
        // Every item of a list, so one value written over a list replaces the list rather than its first item — for both written forms, since the punctuation between items falls inside the span.
        Some(field) => match (field.values.first(), field.values.last()) {
            (Some(first), Some(last)) => (first.range.start..last.range.end, written.to_string()),
            _ => (
                value_slot(text, &field.key_range, body_end),
                format!(" {written}"),
            ),
        },
        None => match empty_key_range(&block, key) {
            Some(key_range) => (
                value_slot(text, &key_range, body_end),
                format!(" {written}"),
            ),
            None => (
                body_end..body_end,
                format!(
                    "{key}: {written}{}",
                    line_break(if block.body.is_empty() {
                        text
                    } else {
                        &block.body
                    })
                ),
            ),
        },
    };
    (text[range.clone()] != written).then_some(FieldSplice {
        range,
        text: written,
    })
}

/// Remove one field: its whole line, and the item lines under it when it has them. Taking the last thing in the block takes the fences with it, rather than leaving an empty pair at the top of the file. `None` when no field answers to that name — a line the parser refused is never guessed at, so a nested `name:` is not what removing `name` takes.
pub fn remove_field(text: &str, key: &str) -> Option<FieldSplice> {
    let block = extract_frontmatter(text)?;
    let parsed = parse_frontmatter(&block);
    let field = parsed.fields.iter().find(|field| field.key_is(key))?;
    let last = field
        .values
        .iter()
        .map(|value| value.range.end)
        .max()
        .unwrap_or(field.key_range.end)
        .max(field.key_range.end);
    let body_end = block.offset + block.body.len();
    let start = line_start(text, field.key_range.start, block.offset);
    let end = line_end(text, last, body_end);
    // What the block would still hold. A comment or a refused line is worth keeping the fences for; nothing at all is not.
    let rest = format!("{}{}", &text[block.offset..start], &text[end..body_end]);
    if !rest.trim().is_empty() {
        return Some(FieldSplice {
            range: start..end,
            text: String::new(),
        });
    }
    // Past a byte order mark, which is not the block's, and past the blank line under the closing fence so the document does not open on one.
    let opens = text.len() - text.strip_prefix('\u{feff}').unwrap_or(text).len();
    let mut closes = line_end(text, body_end, text.len());
    if text[closes..].starts_with("\r\n") || text[closes..].starts_with('\n') {
        closes = line_end(text, closes, text.len());
    }
    Some(FieldSplice {
        range: opens..closes,
        text: String::new(),
    })
}

/// How a list was written, so it is written back the same way rather than reformatted into whichever form this code prefers.
enum ListForm {
    /// `key: [a, b]`.
    Inline,
    /// `key:` and a `- item` line each, at the indent the file used.
    Block(String),
}

/// An item as it goes inside `[ ... ]`, or `None` for one the inline form cannot hold. A closing bracket is quoted away; a comma is not, because [`inline_array_items`] splits on every comma in the line, quoted or not, so an item carrying one could not be read back whatever it was written as. A `- item` list has no such trouble and takes it.
fn write_inline_item(item: &str) -> Option<String> {
    if item.contains(',') {
        return None;
    }
    if item.contains(']') {
        let mark = quote_mark(item);
        return Some(format!("{mark}{item}{mark}"));
    }
    Some(write_value(item, None))
}

/// Every item as the inline form would write them, or `None` when one of them cannot go there.
fn write_inline_items(items: &[&str]) -> Option<String> {
    items
        .iter()
        .map(|item| write_inline_item(item))
        .collect::<Option<Vec<_>>>()
        .map(|written| written.join(", "))
}

/// Set every item of a list field at once, in the form the file already wrote it — an inline `[a, b]` stays inline and a `- item` list keeps its own indent. Empty rewrites the field as `key: []`, because a key with no items under it is a key the parser stops reporting at all.
///
/// `None` when an item carries a line break, or when the change leaves the document as it was.
pub fn set_list_field(text: &str, key: &str, items: &[&str]) -> Option<FieldSplice> {
    let items: Vec<&str> = items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .collect();
    if items.iter().any(|item| item.contains(['\n', '\r'])) {
        return None;
    }
    let Some(block) = extract_frontmatter(text) else {
        return set_written_field(text, key, &format!("[{}]", write_inline_items(&items)?));
    };
    let parsed = parse_frontmatter(&block);
    let body_end = block.offset + block.body.len();
    let end = line_break(if block.body.is_empty() {
        text
    } else {
        &block.body
    });
    let Some(field) = parsed.fields.iter().find(|field| field.key_is(key)) else {
        return set_written_field(text, key, &format!("[{}]", write_inline_items(&items)?));
    };
    let (Some(first), Some(last)) = (field.values.first(), field.values.last()) else {
        return set_written_field(text, key, &format!("[{}]", write_inline_items(&items)?));
    };
    // An empty list cannot be written over the items alone: a block list would keep the `- ` that opened its first one, and a key with no items is a key the parser leaves out. The whole field is rewritten instead, keeping its own case.
    if items.is_empty() {
        let range = line_start(text, field.key_range.start, block.offset)
            ..line_end(text, last.range.end.max(field.key_range.end), body_end);
        let written = format!("{}: []{end}", &text[field.key_range.clone()]);
        return (text[range.clone()] != written).then_some(FieldSplice {
            range,
            text: written,
        });
    }
    let form = match text[block.offset..first.range.start]
        .trim_end()
        .ends_with('[')
    {
        true => ListForm::Inline,
        false => {
            let at = line_start(text, first.range.start, block.offset);
            ListForm::Block(
                text[at..first.range.start]
                    .trim_end_matches("- ")
                    .to_string(),
            )
        }
    };
    let written = match &form {
        ListForm::Inline => write_inline_items(&items)?,
        // Past the first, each item brings the line and the dash that carry it; the first sits in the one the file already has.
        ListForm::Block(indent) => items
            .iter()
            .map(|item| write_value(item, None))
            .collect::<Vec<_>>()
            .join(&format!("{end}{indent}- ")),
    };
    let range = first.range.start..last.range.end;
    (text[range.clone()] != written).then_some(FieldSplice {
        range,
        text: written,
    })
}

/// Rename one field's key, keeping its value, its quoting and its place in the block — one splice over the key's own bytes, never a remove and an add that would move it to the bottom. `None` when no field answers to `key`, when `to` is already a key in the block (the parser would refuse the second), or when the name is empty or carries something no key can hold.
pub fn rename_field(text: &str, key: &str, to: &str) -> Option<FieldSplice> {
    let to = to.trim();
    if to.is_empty() || to.contains([':', '\n', '\r']) || to.starts_with(['#', '-']) {
        return None;
    }
    let block = extract_frontmatter(text)?;
    let parsed = parse_frontmatter(&block);
    if !key.eq_ignore_ascii_case(to) && parsed.fields.iter().any(|field| field.key_is(to)) {
        return None;
    }
    let field = parsed.fields.iter().find(|field| field.key_is(key))?;
    (text[field.key_range.clone()] != *to).then(|| FieldSplice {
        range: field.key_range.clone(),
        text: to.to_string(),
    })
}

/// A document's frontmatter fields, empty when it has none. One extract-and-parse, so something wanting two keys out of the block does not read it twice.
pub fn document_fields(text: &str) -> Vec<FrontmatterField> {
    extract_frontmatter(text)
        .map(|block| parse_frontmatter(&block).fields)
        .unwrap_or_default()
}

/// Every value of the `aliases` field, in file order. `aliases` is a list however the file wrote it — a bare string, an inline array or a block list — so there is one field and this walks its items.
fn alias_values(fields: &[FrontmatterField]) -> impl Iterator<Item = &str> {
    fields
        .iter()
        .filter(|field| field.key_is("aliases"))
        .flat_map(|field| field.values.iter().map(|value| value.text.as_str()))
}

/// The other names a document answers to: its `aliases`, as written, in file order. Deduped by the key names are matched on, and capped at [`MAX_ALIASES`] — which counts aliases, so a list of forty offers thirty-two.
///
/// An alias equal to the document's own name is dropped — it is already the label, and keeping it would offer the same note to the popup twice.
pub fn aliases_from(fields: &[FrontmatterField], label: &str) -> Vec<String> {
    let mut claimed: HashSet<String> = [normalize_name_key(label)].into();
    let mut names = Vec::new();
    for alias in alias_values(fields) {
        if names.len() >= MAX_ALIASES {
            break;
        }
        let key = normalize_name_key(alias);
        if key.is_empty() || !claimed.insert(key) {
            continue;
        }
        names.push(alias.to_string());
    }
    names
}

/// How many aliases a document claims before the cap, so something can say how many were left out. Counts what [`aliases_from`] would count, uncapped.
pub fn alias_count(fields: &[FrontmatterField], label: &str) -> usize {
    let mut claimed: HashSet<String> = [normalize_name_key(label)].into();
    alias_values(fields)
        .filter(|alias| {
            let key = normalize_name_key(alias);
            !key.is_empty() && claimed.insert(key)
        })
        .count()
}
