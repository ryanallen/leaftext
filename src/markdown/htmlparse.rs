//! Scanning HTML tags and attributes. No policy here, only parsing.
//!
//! Depends on nothing else in the crate: it is string scanning over borrowed
//! input, which is why there is no `use super::*` below.

pub(crate) fn html_tag_name(tag: &str) -> Option<String> {
    let mut index = 1usize;
    if tag.as_bytes().get(index).copied() == Some(b'/') {
        index += 1;
    }
    index = skip_html_whitespace(tag, index);
    let name_start = index;
    while index < tag.len() {
        let character = tag[index..].chars().next()?;
        if !(character.is_ascii_alphanumeric() || matches!(character, '-' | ':')) {
            break;
        }
        index += character.len_utf8();
    }
    (index > name_start).then(|| tag[name_start..index].to_ascii_lowercase())
}

pub(crate) fn is_html_closing_tag(tag: &str) -> bool {
    tag[1..].trim_start().starts_with('/')
}

pub(crate) fn is_html_self_closing_tag(tag: &str) -> bool {
    tag[..tag.len().saturating_sub(1)].trim_end().ends_with('/')
}

/// Whether `tag` carries `attribute_name`, with or without a value. Tokenizes
/// like [`find_html_attribute`] so a substring inside another attribute's value
/// (e.g. `title="open sesame"`) doesn't false-positive.
pub(crate) fn html_has_boolean_attribute(tag: &str, attribute_name: &str) -> bool {
    let mut index = tag.find(char::is_whitespace).unwrap_or(tag.len());

    while index < tag.len() {
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() || tag[index..].starts_with('>') || tag[index..].starts_with("/>") {
            break;
        }

        let name_start = index;
        while index < tag.len() {
            let Some(character) = tag[index..].chars().next() else {
                break;
            };
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.') {
                index += character.len_utf8();
            } else {
                break;
            }
        }
        if name_start == index {
            let Some(character) = tag[index..].chars().next() else {
                break;
            };
            index += character.len_utf8();
            continue;
        }
        let name = &tag[name_start..index];
        index = skip_html_whitespace(tag, index);

        // Skip any `="value"` so the scan stays aligned on the next name.
        if tag[index..].starts_with('=') {
            index += 1;
            index = skip_html_whitespace(tag, index);
            if let Some(first) = tag[index..].chars().next() {
                if first == '"' || first == '\'' {
                    index += first.len_utf8();
                    while index < tag.len() {
                        let Some(character) = tag[index..].chars().next() else {
                            break;
                        };
                        index += character.len_utf8();
                        if character == first {
                            break;
                        }
                    }
                } else {
                    while index < tag.len() {
                        let Some(character) = tag[index..].chars().next() else {
                            break;
                        };
                        if character.is_whitespace() || character == '>' {
                            break;
                        }
                        index += character.len_utf8();
                    }
                }
            }
        }

        if name.eq_ignore_ascii_case(attribute_name) {
            return true;
        }
    }

    false
}

pub(crate) fn find_html_tag_end(html: &str, tag_start: usize) -> Option<usize> {
    let mut quote = None;

    for (relative_index, character) in html[tag_start..].char_indices() {
        match (quote, character) {
            (Some(active_quote), current) if current == active_quote => quote = None,
            (None, '"' | '\'') => quote = Some(character),
            (None, '>') => return Some(tag_start + relative_index + character.len_utf8()),
            _ => {}
        }
    }

    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct HtmlAttribute<'a> {
    pub(crate) value: &'a str,
    pub(crate) replacement_start: usize,
    pub(crate) replacement_end: usize,
    pub(crate) was_quoted: bool,
}

pub(crate) fn find_html_attribute<'a>(
    tag: &'a str,
    attribute_name: &str,
) -> Option<HtmlAttribute<'a>> {
    let mut index = tag.find(char::is_whitespace).unwrap_or(tag.len());

    while index < tag.len() {
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() || tag[index..].starts_with('>') || tag[index..].starts_with("/>") {
            break;
        }

        let name_start = index;
        while index < tag.len() {
            let character = tag[index..].chars().next()?;
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.') {
                index += character.len_utf8();
            } else {
                break;
            }
        }
        if name_start == index {
            index += tag[index..].chars().next()?.len_utf8();
            continue;
        }
        let name = &tag[name_start..index];
        index = skip_html_whitespace(tag, index);

        if !tag[index..].starts_with('=') {
            continue;
        }

        index += 1;
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() {
            break;
        }

        let value_start;
        let value_end;
        let was_quoted;
        let first = tag[index..].chars().next()?;
        if first == '"' || first == '\'' {
            was_quoted = true;
            index += first.len_utf8();
            value_start = index;
            while index < tag.len() {
                let character = tag[index..].chars().next()?;
                if character == first {
                    break;
                }
                index += character.len_utf8();
            }
            value_end = index;
            if index < tag.len() {
                index += first.len_utf8();
            }
        } else {
            was_quoted = false;
            value_start = index;
            while index < tag.len() {
                let character = tag[index..].chars().next()?;
                if character.is_whitespace() || character == '>' {
                    break;
                }
                index += character.len_utf8();
            }
            value_end = index;
        }

        if name.eq_ignore_ascii_case(attribute_name) {
            return Some(HtmlAttribute {
                value: &tag[value_start..value_end],
                replacement_start: value_start,
                replacement_end: value_end,
                was_quoted,
            });
        }
    }

    None
}

pub(crate) fn skip_html_whitespace(text: &str, mut index: usize) -> usize {
    while index < text.len() {
        let Some(character) = text[index..].chars().next() else {
            break;
        };
        if !character.is_whitespace() {
            break;
        }
        index += character.len_utf8();
    }
    index
}
