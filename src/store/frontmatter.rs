//! YAML frontmatter: locating it, parsing it, storing its fields.

/// The leading frontmatter block's inner text (between the `---` fences), with
/// the fences and any leading byte order mark removed. A file read from disk has
/// already had its mark taken off; this covers text from anywhere else.
#[derive(Debug, Clone, PartialEq)]
pub struct FrontmatterBlock {
    pub body: String,
}

/// One normalized frontmatter field. `key` is lowercase; a list value expands to
/// one field per item. Untrusted; the frontend escapes before the DOM.
#[derive(Debug, Clone, PartialEq)]
pub struct FrontmatterField {
    pub key: String,
    pub value: String,
}

/// The normalized output of parsing a frontmatter block.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedFrontmatter {
    pub fields: Vec<FrontmatterField>,
}

/// A frontmatter block that could not be interpreted as a key/value mapping at
/// all. Recorded for diagnostics; it never fails the file.
#[derive(Debug, Clone, PartialEq)]
pub enum MetadataError {
    Unparseable,
}

impl std::fmt::Display for MetadataError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MetadataError::Unparseable => {
                write!(f, "frontmatter is not a key/value mapping")
            }
        }
    }
}

/// Extract the leading frontmatter block, if any. Detected only when `---` is
/// the first line (after an optional BOM) and a later `---` closes it; a `---`
/// deeper in the document is body content.
pub fn extract_frontmatter(text: &str) -> Option<FrontmatterBlock> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    // `str::lines` strips trailing `\r` (CRLF works); fence trailing spaces tolerated.
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let mut body = String::new();
    for line in lines {
        if line.trim_end() == "---" {
            return Some(FrontmatterBlock { body });
        }
        body.push_str(line);
        body.push('\n');
    }
    // No closing fence: this is not a frontmatter block.
    None
}

/// Strip one layer of matching surrounding quotes from a scalar value.
fn strip_quotes(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

/// Parse the inline-array form `[a, b, c]`, returning the cleaned, non-empty
/// items. The caller has already confirmed the brackets.
fn parse_inline_array(inner: &str) -> Vec<String> {
    inner
        .split(',')
        .map(|item| strip_quotes(item.trim()).trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

/// Parse a frontmatter block into normalized key/value fields. Unrecognized
/// lines are skipped. Returns `Err` only when the block has content but nothing
/// parsed as a mapping (the file is still indexed either way).
pub fn parse_frontmatter(block: &FrontmatterBlock) -> Result<ParsedFrontmatter, MetadataError> {
    let mut fields: Vec<FrontmatterField> = Vec::new();
    let mut bad_lines = 0usize;
    // The key of the most recent `key:` line with an empty value, which a run of
    // `- item` lines attaches to (block-list form).
    let mut list_key: Option<String> = None;

    for raw in block.body.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // A block-list item attaches to the pending list key.
        if let Some(item) = trimmed.strip_prefix("- ").or_else(|| {
            // A bare `-` (empty item) is ignored rather than treated as bad.
            (trimmed == "-").then_some("")
        }) {
            match &list_key {
                Some(key) => {
                    let value = strip_quotes(item.trim()).trim();
                    if !value.is_empty() {
                        fields.push(FrontmatterField {
                            key: key.clone(),
                            value: value.to_string(),
                        });
                    }
                    continue;
                }
                None => {
                    bad_lines += 1;
                    continue;
                }
            }
        }

        // Otherwise it must be a `key: ...` line. Split on the first colon.
        let Some((key_part, value_part)) = line.split_once(':') else {
            bad_lines += 1;
            continue;
        };
        let key = key_part.trim().to_lowercase();
        if key.is_empty() {
            bad_lines += 1;
            continue;
        }
        let value = value_part.trim();

        if value.is_empty() {
            // `key:` opens a possible block list; rows come from following items.
            list_key = Some(key);
            continue;
        }
        list_key = None;

        if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            for item in parse_inline_array(inner) {
                fields.push(FrontmatterField {
                    key: key.clone(),
                    value: item,
                });
            }
        } else {
            fields.push(FrontmatterField {
                key,
                value: strip_quotes(value).trim().to_string(),
            });
        }
    }

    if fields.is_empty() && bad_lines > 0 {
        return Err(MetadataError::Unparseable);
    }
    Ok(ParsedFrontmatter { fields })
}
