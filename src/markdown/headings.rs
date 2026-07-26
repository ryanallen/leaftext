//! Heading anchors, and the title a document reports.

use super::*;

pub(crate) fn add_markdown_heading_ids(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut transformed = Vec::with_capacity(events.len());
    let mut seen = HashSet::new();
    let mut heading: Option<HeadingIdCapture> = None;

    for event in events {
        if let Some(capture) = &mut heading {
            match event {
                Event::End(TagEnd::Heading(level)) => {
                    let slug = unique_heading_slug(&capture.text, &mut seen);
                    transformed.push(Event::Start(Tag::Heading {
                        level,
                        id: Some(cowstr(&slug)),
                        classes: capture.classes.clone(),
                        attrs: capture.attrs.clone(),
                    }));
                    transformed.extend(capture.events.drain(..));
                    transformed.push(Event::End(TagEnd::Heading(level)));
                    heading = None;
                }
                other => {
                    append_heading_slug_text(&other, &mut capture.text);
                    capture.events.push(other);
                }
            }
            continue;
        }

        match event {
            Event::Start(Tag::Heading {
                level,
                id: Some(id),
                classes,
                attrs,
            }) => {
                seen.insert(id.to_string());
                transformed.push(Event::Start(Tag::Heading {
                    level,
                    id: Some(id),
                    classes,
                    attrs,
                }));
            }
            Event::Start(Tag::Heading {
                level,
                id: None,
                classes,
                attrs,
            }) => {
                heading = Some(HeadingIdCapture {
                    level,
                    classes,
                    attrs,
                    events: Vec::new(),
                    text: String::new(),
                });
            }
            other => transformed.push(other),
        }
    }

    if let Some(mut capture) = heading {
        let slug = unique_heading_slug(&capture.text, &mut seen);
        transformed.push(Event::Start(Tag::Heading {
            level: capture.level,
            id: Some(cowstr(&slug)),
            classes: capture.classes,
            attrs: capture.attrs,
        }));
        transformed.extend(capture.events.drain(..));
    }

    transformed
}

#[derive(Debug)]
pub(crate) struct HeadingIdCapture {
    pub(crate) level: HeadingLevel,
    pub(crate) classes: Vec<CowStr<'static>>,
    pub(crate) attrs: Vec<(CowStr<'static>, Option<CowStr<'static>>)>,
    pub(crate) events: Vec<Event<'static>>,
    pub(crate) text: String,
}

pub(crate) fn append_heading_slug_text(event: &Event<'_>, text: &mut String) {
    match event {
        Event::Text(value) | Event::Code(value) => text.push_str(value.as_ref()),
        Event::InlineHtml(value) | Event::Html(value) => {
            text.push_str(&strip_html_tags(value.as_ref()));
        }
        Event::SoftBreak | Event::HardBreak => text.push(' '),
        _ => {}
    }
}

pub(crate) fn strip_html_tags(value: &str) -> String {
    let mut stripped = String::with_capacity(value.len());
    let mut in_tag = false;

    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => stripped.push(character),
            _ => {}
        }
    }

    stripped
}

pub(crate) fn unique_heading_slug(text: &str, seen: &mut HashSet<String>) -> String {
    let base = heading_slug_base(text);
    if seen.insert(base.clone()) {
        return base;
    }

    let mut index = 1usize;
    loop {
        let candidate = format!("{base}-{index}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
        index += 1;
    }
}

pub(crate) fn heading_slug_base(text: &str) -> String {
    let normalized = text.trim().to_lowercase();
    let mut slug = String::with_capacity(normalized.len());

    for character in normalized.chars() {
        if character.is_alphanumeric() || matches!(character, '_' | '-') {
            slug.push(character);
        } else if character.is_whitespace() {
            slug.push('-');
        }
    }

    if slug.is_empty() {
        "heading".to_string()
    } else {
        slug
    }
}

pub(crate) fn markdown_title(markdown: &str) -> Option<String> {
    let events = parse_markdown_source(markdown, MarkdownParserConfig::github_flavored());
    markdown_heading_title(&events).or_else(|| raw_html_block_title(&events))
}

pub(crate) fn markdown_heading_title(events: &[Event<'static>]) -> Option<String> {
    let mut heading_text = String::new();
    let mut in_heading = false;

    for event in events {
        match event {
            Event::Start(Tag::Heading { .. }) => {
                in_heading = true;
                heading_text.clear();
            }
            Event::End(TagEnd::Heading(_)) if in_heading => {
                if let Some(title) = plain_document_title(&heading_text) {
                    return Some(title);
                }
                in_heading = false;
            }
            _ if in_heading => append_title_text(event, &mut heading_text),
            _ => {}
        }
    }

    None
}

pub(crate) fn raw_html_block_title(events: &[Event<'static>]) -> Option<String> {
    events.iter().find_map(|event| {
        if let Event::Html(html) | Event::InlineHtml(html) = event {
            plain_document_title_from_html(html.as_ref())
        } else {
            None
        }
    })
}

pub(crate) fn append_title_text(event: &Event<'_>, text: &mut String) {
    match event {
        Event::Text(value) | Event::Code(value) => text.push_str(value.as_ref()),
        Event::InlineHtml(value) | Event::Html(value) => {
            text.push_str(&strip_html_tags(value.as_ref()));
        }
        Event::SoftBreak | Event::HardBreak => text.push(' '),
        _ => {}
    }
}

pub(crate) fn plain_document_title_from_html(value: &str) -> Option<String> {
    let stripped = strip_html_tags(value);
    plain_document_title(&stripped)
}

pub(crate) fn plain_document_title(value: &str) -> Option<String> {
    let decoded = decode_html_entities(value);
    let normalized = normalize_title_whitespace(decoded.as_ref());
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

pub(crate) fn normalize_title_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
