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
