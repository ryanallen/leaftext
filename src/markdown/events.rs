//! Transforms over the event stream between parse and render.

use super::*;

/// Leaf custom Markdown: a link wrapped in braces renders as a button — an `<a class="leaf-md-button …">` styled like the app's action buttons. The more braces, the more prominent the button:
///
/// - `{[Label](url)}` → ghost (no fill or outline until hover)
/// - `{{[Label](url)}}` → outline (fills on hover)
/// - `{{{[Label](url)}}}` → filled
///
/// Braces only: brackets would be read as link syntax, leaving the wrapper behind as literal text beside a plain link.
///
/// The braces may also name a mark the button wears — `{{{icon:windows[Download for Windows](url)}}}` — which is the renderer's to put there, not the author's to draw: the sanitizer keeps no `class` on a `<span>`, and a document that could name one could wear any part of the app's own interface.
///
/// Links can't nest in CommonMark, so the braces stay literal: they arrive as the tail of the Text before the link and the head of the Text after it. We strip the matched run from each side and wrap the label in the button anchor. Working on Link events is what keeps the syntax literal inside code.
pub(crate) fn button_links(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut out: Vec<Event<'static>> = Vec::with_capacity(events.len());
    let mut index = 0;
    while index < events.len() {
        if let Event::Start(Tag::Link { dest_url, .. }) = &events[index] {
            if let Some(end) = link_end_index(&events, index) {
                // Braces merge with adjacent prose, so each side is a run at one Text boundary.
                let (open, icon, opener) = out_trailing_button_open(&out);
                let close = event_leading_run(events.get(end + 1), '}');

                // Lopsided wrappers are prose, not a button, and are left alone.
                let variant = (open == close)
                    .then(|| match open {
                        1 => Some(" leaf-md-button--ghost"),
                        2 => Some(" leaf-md-button--secondary"),
                        3 => Some(""),
                        _ => None,
                    })
                    .flatten();

                if let Some(variant) = variant {
                    strip_out_trailing_chars(&mut out, opener);
                    out.push(Event::InlineHtml(cowstr(&format!(
                        r#"<a class="leaf-md-button{variant}" href="{}">"#,
                        encode_double_quoted_attribute(dest_url.as_ref())
                    ))));
                    if let Some(icon) = icon {
                        out.push(Event::InlineHtml(cowstr(&format!(
                            r#"<span class="lt-icon lt-icon-{icon}"></span>"#
                        ))));
                    }
                    out.extend(events[index + 1..end].iter().cloned());
                    out.push(Event::InlineHtml(cowstr("</a>")));
                    // Keep any prose that merged onto the far side of the braces.
                    if let Some(Event::Text(text)) = events.get(end + 1) {
                        let tail = &text.as_ref()[close..];
                        if !tail.is_empty() {
                            out.push(Event::Text(cowstr(tail)));
                        }
                    }
                    index = end + 2;
                    continue;
                }
            }
        }
        out.push(events[index].clone());
        index += 1;
    }
    out
}

/// The text of `event`, if it is a `Text` event.
fn event_text<'a>(event: &'a Event<'static>) -> Option<&'a str> {
    match event {
        Event::Text(text) => Some(text.as_ref()),
        _ => None,
    }
}

/// How many `ch` in a row `event`'s text opens with, if it is a `Text` event.
fn event_leading_run(event: Option<&Event<'static>>, ch: char) -> usize {
    event
        .and_then(event_text)
        .map(|text| text.chars().take_while(|c| *c == ch).count())
        .unwrap_or(0)
}

/// The marks a document may wear inside a button, and the whole of them. Every entry owes a row in `design/icons.md`, or the page is asked for a mask nothing generates.
pub(crate) const DOCUMENT_BUTTON_ICONS: &[&str] = &["apple", "windows"];

/// The button wrapper on the tail of `out`: how many `{` it opens with, the mark it names, and how many characters of it to strip.
///
/// An unknown name is no button at all, and the run stays literal prose — the way a lopsided wrapper already does.
fn out_trailing_button_open(out: &[Event<'static>]) -> (usize, Option<&'static str>, usize) {
    let Some(text) = out.last().and_then(event_text) else {
        return (0, None, 0);
    };
    let named = text.rsplit_once("icon:").filter(|(_, name)| {
        !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c == '-')
    });
    let (head, icon, named_len) = match named {
        Some((head, name)) => {
            let Some(known) = DOCUMENT_BUTTON_ICONS.iter().find(|icon| **icon == name) else {
                return (0, None, 0);
            };
            (head, Some(*known), name.len() + "icon:".len())
        }
        None => (text, None, 0),
    };
    let braces = head.chars().rev().take_while(|c| *c == '{').count();
    (braces, icon, braces + named_len)
}

/// Drop the last `count` (single-byte wrapper) characters from the final `Text` event in `out`, removing the event entirely if that empties it.
fn strip_out_trailing_chars(out: &mut Vec<Event<'static>>, count: usize) {
    if let Some(Event::Text(text)) = out.last() {
        let trimmed = &text.as_ref()[..text.len() - count];
        if trimmed.is_empty() {
            out.pop();
        } else {
            let replacement = Event::Text(cowstr(trimmed));
            if let Some(last) = out.last_mut() {
                *last = replacement;
            }
        }
    }
}

/// Index of the `End(Link)` that closes the `Start(Link)` at `start`. Links can't nest, so it's the first link end after the start.
fn link_end_index(events: &[Event<'static>], start: usize) -> Option<usize> {
    events[start + 1..]
        .iter()
        .position(|event| matches!(event, Event::End(TagEnd::Link)))
        .map(|offset| start + 1 + offset)
}

pub(crate) fn table_cell_task_list_markers(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut transformed = Vec::with_capacity(events.len());
    let mut table_cell: Option<Vec<Event<'static>>> = None;

    for event in events {
        if let Some(mut cell_events) = table_cell.take() {
            match event {
                Event::End(TagEnd::TableCell) => {
                    if let Some(checked) = table_cell_task_marker(&cell_events) {
                        transformed.push(Event::TaskListMarker(checked));
                    } else {
                        transformed.extend(cell_events);
                    }
                    transformed.push(Event::End(TagEnd::TableCell));
                }
                other => {
                    cell_events.push(other);
                    table_cell = Some(cell_events);
                }
            }
            continue;
        }

        match event {
            Event::Start(Tag::TableCell) => {
                transformed.push(Event::Start(Tag::TableCell));
                table_cell = Some(Vec::new());
            }
            other => transformed.push(other),
        }
    }

    if let Some(cell_events) = table_cell {
        transformed.extend(cell_events);
    }

    transformed
}

pub(crate) fn table_cell_task_marker(events: &[Event<'static>]) -> Option<bool> {
    let mut text = String::new();
    let mut saw_text = false;

    for event in events {
        match event {
            Event::Text(value) => {
                saw_text = true;
                text.push_str(value.as_ref());
            }
            Event::SoftBreak | Event::HardBreak => text.push('\n'),
            _ => return None,
        }
    }

    if !saw_text {
        return None;
    }

    match text.trim() {
        "[ ]" => Some(false),
        "[x]" | "[X]" => Some(true),
        _ => None,
    }
}

pub(crate) fn linkify_plain_text(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut finder = LinkFinder::new();
    finder
        .kinds(&[LinkKind::Url, LinkKind::Email])
        .url_must_have_scheme(false);

    let mut link_depth = 0usize;
    let mut transformed = Vec::new();

    for event in events {
        match event {
            Event::Start(Tag::Link { .. }) | Event::Start(Tag::Image { .. }) => {
                link_depth += 1;
                transformed.push(event);
            }
            Event::End(TagEnd::Link) | Event::End(TagEnd::Image) => {
                link_depth = link_depth.saturating_sub(1);
                transformed.push(event);
            }
            Event::Text(text) if link_depth == 0 => {
                append_autolink_events(text.as_ref(), &finder, &mut transformed);
            }
            _ => transformed.push(event),
        }
    }

    transformed
}

pub(crate) fn append_autolink_events(
    text: &str,
    finder: &LinkFinder,
    events: &mut Vec<Event<'static>>,
) {
    let mut offset = 0;

    for link in finder.links(text) {
        if link.start() > offset {
            events.push(Event::Text(cowstr(&text[offset..link.start()])));
        }

        let link_text = link.as_str();
        if let Some(destination) = autolink_destination(link_text, link.kind()) {
            events.push(Event::Start(Tag::Link {
                link_type: LinkType::Autolink,
                dest_url: cowstr(&destination),
                title: CowStr::Borrowed(""),
                id: CowStr::Borrowed(""),
            }));
            events.push(Event::Text(cowstr(link_text)));
            events.push(Event::End(TagEnd::Link));
        } else {
            events.push(Event::Text(cowstr(link_text)));
        }

        offset = link.end();
    }

    if offset < text.len() {
        events.push(Event::Text(cowstr(&text[offset..])));
    }
}

pub(crate) fn autolink_destination(text: &str, kind: &LinkKind) -> Option<String> {
    match kind {
        LinkKind::Email => Some(format!("mailto:{text}")),
        LinkKind::Url if starts_with_url_scheme(text) => Some(text.to_string()),
        LinkKind::Url if text.starts_with("www.") => Some(format!("http://{text}")),
        _ => None,
    }
}

pub(crate) fn starts_with_url_scheme(text: &str) -> bool {
    text.starts_with("http://") || text.starts_with("https://")
}

/// The web addresses in a run of plain text, found by the same finder that turns them into links when the document is rendered.
///
/// One definition, deliberately: the [graph](crate::store::document_links) counts a bare URL as a link because the reader can click it, and the only way that stays true is for both to ask the same question. Without it, a document of nothing but bare links draws an empty map — the renderer linkifies them here, and a bare `Parser` never sees them at all.
///
/// Email addresses are found and dropped: `mailto:` is not somewhere a map goes.
pub(crate) fn plain_text_urls(text: &str) -> Vec<String> {
    let mut finder = LinkFinder::new();
    finder.kinds(&[LinkKind::Url]).url_must_have_scheme(false);
    finder
        .links(text)
        .filter_map(|link| autolink_destination(link.as_str(), link.kind()))
        .filter(|destination| starts_with_url_scheme(destination))
        .collect()
}
