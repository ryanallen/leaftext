use crate::*;

pub(crate) const MINIMAP_LONG_LINE_CHAR_THRESHOLD: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentMinimap {
    pub line_count: usize,
    /// The line-by-line shape of the document. Not sent to the page, which draws the rail from a scaled clone of the real rendering and reads only `line_count`. These were 5.5 MB of an 18.9 MB payload on a 4 MB glossary, parsed every open for nothing.
    #[serde(default, skip_serializing)]
    pub spans: Vec<MinimapSpan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MinimapSpan {
    pub start_line: usize,
    pub line_count: usize,
    pub category: MinimapLineCategory,
    pub structure: MinimapLineStructure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MinimapLineCategory {
    Heading,
    Paragraph,
    Blank,
    List,
    Blockquote,
    CodeFence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MinimapLineStructure {
    Short,
    Long,
}

pub fn build_minimap_model(markdown: &str) -> DocumentMinimap {
    let lines: Vec<&str> = markdown.lines().collect();
    let mut spans: Vec<MinimapSpan> = Vec::new();
    let mut fence: Option<MinimapFence> = None;

    for (line_index, line) in lines.iter().enumerate() {
        let category = minimap_line_category(&lines, line_index, &mut fence);
        let structure = minimap_line_structure(line);

        if let Some(span) = spans.last_mut() {
            if span.category == category && span.structure == structure {
                span.line_count += 1;
                continue;
            }
        }

        spans.push(MinimapSpan {
            start_line: line_index,
            line_count: 1,
            category,
            structure,
        });
    }

    DocumentMinimap {
        line_count: lines.len(),
        spans,
    }
}

/// Build a minimap model from rendered block HTML, for TEI/XML documents that have no Markdown source to line-scan. Each top-level block becomes synthetic rows: headings as full bars, paragraphs/blockquotes sized to text length, lists by item count, code by line count. These row counts only shape the cosmetic thumbnail; the viewport box comes from the reader's real scroll range (see `measureDocumentMinimap` in the shell).
pub fn build_minimap_model_from_html(html: &str) -> DocumentMinimap {
    let mut spans: Vec<MinimapSpan> = Vec::new();
    let mut next_line: usize = 0;
    collect_html_minimap_blocks(html, &mut spans, &mut next_line);
    DocumentMinimap {
        line_count: next_line,
        spans,
    }
}

/// Rows a run of body text occupies in the thumbnail, at the same characters-per- line budget the Markdown model treats as a "long" line.
pub(crate) fn minimap_rows_for_text(chars: usize) -> usize {
    chars.div_ceil(MINIMAP_LONG_LINE_CHAR_THRESHOLD).max(1)
}

/// Visible-character count of an HTML fragment: tags stripped, whitespace runs collapsed to one. Used only to size thumbnail rows, so an approximate count (entities counted as their raw characters) is fine.
pub(crate) fn minimap_html_text_len(html: &str) -> usize {
    let mut count = 0;
    let mut in_tag = false;
    let mut prev_ws = false;
    for character in html.chars() {
        if in_tag {
            if character == '>' {
                in_tag = false;
            }
            continue;
        }
        if character == '<' {
            in_tag = true;
            continue;
        }
        if character.is_whitespace() {
            if !prev_ws {
                count += 1;
                prev_ws = true;
            }
            continue;
        }
        count += 1;
        prev_ws = false;
    }
    count
}

/// True when the character right after a matched `<tag` / `</tag` prefix is not a letter or digit, i.e. the prefix is the whole tag name (`<p>` matches `<p`, but `<pre>` does not).
pub(crate) fn minimap_tag_boundary(html: &str, index: usize) -> bool {
    html[index..]
        .chars()
        .next()
        .map_or(true, |character| !character.is_ascii_alphanumeric())
}

/// Count opening `<name …>` tags in `html` (whole-name matches only). The renderer emits lowercase tags, so a lowercase scan suffices.
pub(crate) fn minimap_count_open_tags(html: &str, name: &str) -> usize {
    let pattern = format!("<{name}");
    let mut count = 0;
    let mut pos = 0;
    while let Some(offset) = html[pos..].find(&pattern) {
        let after = pos + offset + pattern.len();
        if minimap_tag_boundary(html, after) {
            count += 1;
        }
        pos = after;
    }
    count
}

/// Find the `</name>` that closes the `<name>` whose content starts at `open_end`, accounting for nested same-name tags. Returns `(inner_start, inner_end, after_close)`.
pub(crate) fn minimap_matching_close(
    html: &str,
    open_end: usize,
    name: &str,
) -> Option<(usize, usize, usize)> {
    let open_pattern = format!("<{name}");
    let close_pattern = format!("</{name}");
    let mut depth = 1usize;
    let mut pos = open_end;
    while pos < html.len() {
        let next_open = html[pos..].find(&open_pattern).map(|o| pos + o);
        let next_close = html[pos..].find(&close_pattern).map(|o| pos + o);
        match (next_open, next_close) {
            (_, None) => return None,
            (Some(open_at), Some(close_at)) if open_at < close_at => {
                let after = open_at + open_pattern.len();
                if minimap_tag_boundary(html, after) {
                    depth += 1;
                }
                pos = after;
            }
            (_, Some(close_at)) => {
                let after = close_at + close_pattern.len();
                if minimap_tag_boundary(html, after) {
                    depth -= 1;
                    let close_end = close_at + html[close_at..].find('>')? + 1;
                    if depth == 0 {
                        return Some((open_end, close_at, close_end));
                    }
                    pos = close_end;
                } else {
                    pos = after;
                }
            }
        }
    }
    None
}

/// Walk the top-level blocks of an HTML fragment, pushing one span per block (with a one-row gap between blocks so they read as separate bars). Container blocks (`section`, `div`, `article`) and unrecognized wrappers recurse so nested content — e.g. footnote definitions — is still charted.
pub(crate) fn collect_html_minimap_blocks(
    html: &str,
    spans: &mut Vec<MinimapSpan>,
    next_line: &mut usize,
) {
    let mut cursor = 0;
    while cursor < html.len() {
        let Some(lt) = html[cursor..].find('<') else {
            break;
        };
        let start = cursor + lt;
        if html[start..].starts_with("<!--") {
            match html[start..].find("-->") {
                Some(offset) => cursor = start + offset + 3,
                None => break,
            }
            continue;
        }
        let name: String = html[start + 1..]
            .chars()
            .take_while(|character| character.is_ascii_alphanumeric())
            .collect();
        if name.is_empty() {
            cursor = start + 1;
            continue;
        }
        let Some(gt) = html[start..].find('>') else {
            break;
        };
        let open_end = start + gt + 1;
        let self_closing = html[start..open_end].ends_with("/>");
        let (inner, block_end) = if self_closing {
            ("", open_end)
        } else {
            match minimap_matching_close(html, open_end, &name) {
                Some((inner_start, inner_end, close_end)) => {
                    (&html[inner_start..inner_end], close_end)
                }
                None => (&html[open_end..], html.len()),
            }
        };
        push_html_minimap_block(&name, inner, spans, next_line);
        cursor = block_end;
    }
}

/// Classify one HTML block and append its span (or recurse into a container).
pub(crate) fn push_html_minimap_block(
    name: &str,
    inner: &str,
    spans: &mut Vec<MinimapSpan>,
    next_line: &mut usize,
) {
    use MinimapLineCategory::*;
    use MinimapLineStructure::*;

    let long_if = |chars: usize| {
        if chars >= MINIMAP_LONG_LINE_CHAR_THRESHOLD {
            Long
        } else {
            Short
        }
    };

    let (category, structure, rows) = match name {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => (Heading, Long, 1),
        "p" => {
            let chars = minimap_html_text_len(inner);
            (Paragraph, long_if(chars), minimap_rows_for_text(chars))
        }
        "blockquote" => {
            let chars = minimap_html_text_len(inner);
            (Blockquote, long_if(chars), minimap_rows_for_text(chars))
        }
        "ul" | "ol" => (List, Long, minimap_count_open_tags(inner, "li").max(1)),
        "pre" => (CodeFence, Long, inner.matches('\n').count() + 1),
        "section" | "div" | "article" => {
            collect_html_minimap_blocks(inner, spans, next_line);
            return;
        }
        _ => {
            if inner.contains('<') {
                collect_html_minimap_blocks(inner, spans, next_line);
                return;
            }
            let chars = minimap_html_text_len(inner);
            if chars == 0 {
                return;
            }
            (Paragraph, long_if(chars), minimap_rows_for_text(chars))
        }
    };

    spans.push(MinimapSpan {
        start_line: *next_line,
        line_count: rows,
        category,
        structure,
    });
    *next_line += rows + 1;
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct MinimapFence {
    marker: char,
    length: usize,
}

pub(crate) fn minimap_line_category(
    lines: &[&str],
    line_index: usize,
    fence: &mut Option<MinimapFence>,
) -> MinimapLineCategory {
    let line = lines[line_index];

    if let Some(open_fence) = fence {
        let category = MinimapLineCategory::CodeFence;
        if minimap_closes_fence(line, *open_fence) {
            *fence = None;
        }
        return category;
    }

    if line.trim().is_empty() {
        return MinimapLineCategory::Blank;
    }

    if let Some(open_fence) = minimap_opening_fence(line) {
        *fence = Some(open_fence);
        return MinimapLineCategory::CodeFence;
    }

    let trimmed_start = line.trim_start();
    if trimmed_start.starts_with('>') {
        return MinimapLineCategory::Blockquote;
    }

    if minimap_is_atx_heading(trimmed_start)
        || minimap_is_setext_heading_line(lines, line_index)
        || minimap_is_setext_underline_line(lines, line_index)
    {
        return MinimapLineCategory::Heading;
    }

    if minimap_is_list_item(trimmed_start) {
        return MinimapLineCategory::List;
    }

    MinimapLineCategory::Paragraph
}

pub(crate) fn minimap_line_structure(line: &str) -> MinimapLineStructure {
    if line.trim().chars().count() >= MINIMAP_LONG_LINE_CHAR_THRESHOLD {
        MinimapLineStructure::Long
    } else {
        MinimapLineStructure::Short
    }
}

pub(crate) fn minimap_opening_fence(line: &str) -> Option<MinimapFence> {
    let trimmed = minimap_trim_leading_up_to_three_spaces(line)?;
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }

    let length = trimmed
        .chars()
        .take_while(|character| *character == marker)
        .count();
    (length >= 3).then_some(MinimapFence { marker, length })
}

pub(crate) fn minimap_closes_fence(line: &str, fence: MinimapFence) -> bool {
    let Some(trimmed) = minimap_trim_leading_up_to_three_spaces(line) else {
        return false;
    };
    let length = trimmed
        .chars()
        .take_while(|character| *character == fence.marker)
        .count();
    length >= fence.length
        && trimmed[length..]
            .chars()
            .all(|character| character.is_whitespace())
}

pub(crate) fn minimap_trim_leading_up_to_three_spaces(line: &str) -> Option<&str> {
    let space_count = line
        .chars()
        .take_while(|character| *character == ' ')
        .count();
    (space_count <= 3).then_some(&line[space_count..])
}

pub(crate) fn minimap_is_atx_heading(trimmed_start: &str) -> bool {
    let marker_count = trimmed_start
        .chars()
        .take_while(|character| *character == '#')
        .count();

    (1..=6).contains(&marker_count)
        && trimmed_start[marker_count..]
            .chars()
            .next()
            .is_none_or(char::is_whitespace)
}

pub(crate) fn minimap_is_setext_heading_line(lines: &[&str], line_index: usize) -> bool {
    if lines[line_index].trim().is_empty() || line_index + 1 >= lines.len() {
        return false;
    }

    minimap_is_setext_underline(lines[line_index + 1].trim_start())
}

pub(crate) fn minimap_is_setext_underline_line(lines: &[&str], line_index: usize) -> bool {
    line_index > 0
        && !lines[line_index - 1].trim().is_empty()
        && minimap_is_setext_underline(lines[line_index].trim_start())
}

pub(crate) fn minimap_is_setext_underline(trimmed_start: &str) -> bool {
    let trimmed = trimmed_start.trim_end();
    let Some(marker) = trimmed.chars().next() else {
        return false;
    };
    (marker == '=' || marker == '-') && trimmed.chars().all(|character| character == marker)
}

pub(crate) fn minimap_is_list_item(trimmed_start: &str) -> bool {
    if let Some(rest) = trimmed_start
        .strip_prefix("- ")
        .or_else(|| trimmed_start.strip_prefix("+ "))
        .or_else(|| trimmed_start.strip_prefix("* "))
    {
        return !rest.is_empty();
    }

    let digit_count = trimmed_start
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count();
    if digit_count == 0 || digit_count > 9 {
        return false;
    }

    let rest = &trimmed_start[digit_count..];
    rest.strip_prefix(". ")
        .or_else(|| rest.strip_prefix(") "))
        .is_some_and(|item| !item.is_empty())
}
