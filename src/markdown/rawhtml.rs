//! What raw HTML inside Markdown may keep. A security boundary.

use super::*;

pub(crate) fn sanitize_raw_markdown_html(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut sanitized = Vec::with_capacity(events.len());
    let mut skipped_raw_html_content: Option<&'static str> = None;

    for event in events {
        if let Some(tag_name) = skipped_raw_html_content {
            if let Event::Html(html) | Event::InlineHtml(html) = &event {
                if closes_raw_html_content_tag(html, tag_name) {
                    skipped_raw_html_content = None;
                }
            }
            continue;
        }

        match event {
            Event::Html(html) => {
                if let Some(tag_name) = opens_unclosed_raw_html_content_tag(&html) {
                    skipped_raw_html_content = Some(tag_name);
                }
                sanitized.push(Event::Html(cowstr(&sanitize_raw_markdown_html_fragment(
                    &html,
                ))));
            }
            Event::InlineHtml(html) => {
                if let Some(tag_name) = opens_unclosed_raw_html_content_tag(&html) {
                    skipped_raw_html_content = Some(tag_name);
                }
                sanitized.push(Event::InlineHtml(cowstr(
                    &sanitize_raw_markdown_html_fragment(&html),
                )));
            }
            _ => sanitized.push(event),
        }
    }

    sanitized
}

pub(crate) fn sanitize_raw_markdown_html_fragment(html: &str) -> String {
    let mut sanitized = String::with_capacity(html.len());
    let mut offset = 0usize;
    let lower_html = html.to_ascii_lowercase();

    while let Some(relative_start) = html[offset..].find('<') {
        let tag_start = offset + relative_start;
        sanitized.push_str(&html[offset..tag_start]);

        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            sanitized.push_str(&encode_text(&html[tag_start..]));
            return sanitized;
        };

        let tag = &html[tag_start..tag_end];
        if let Some(tag_name) = html_tag_name(tag) {
            if matches!(tag_name.as_str(), "script" | "style") && !is_html_closing_tag(tag) {
                if let Some(close_start) = lower_html[tag_end..].find(&format!("</{tag_name}")) {
                    if let Some(close_end) = find_html_tag_end(html, tag_end + close_start) {
                        offset = close_end;
                        continue;
                    }
                }
                return sanitized;
            }
        }

        sanitized.push_str(&sanitize_raw_markdown_html_tag(tag));
        offset = tag_end;
    }

    sanitized.push_str(&html[offset..]);
    sanitized
}

pub(crate) fn opens_unclosed_raw_html_content_tag(html: &str) -> Option<&'static str> {
    ["script", "style"].into_iter().find(|tag_name| {
        opens_raw_html_content_tag(html, tag_name) && !closes_raw_html_content_tag(html, tag_name)
    })
}

pub(crate) fn opens_raw_html_content_tag(html: &str, tag_name: &str) -> bool {
    let lower_html = html.to_ascii_lowercase();
    let mut offset = 0usize;
    while let Some(relative_start) = lower_html[offset..].find(&format!("<{tag_name}")) {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            return true;
        };
        if html_tag_name(&html[tag_start..tag_end]).as_deref() == Some(tag_name) {
            return true;
        }
        offset = tag_end;
    }
    false
}

pub(crate) fn closes_raw_html_content_tag(html: &str, tag_name: &str) -> bool {
    let lower_html = html.to_ascii_lowercase();
    let mut offset = 0usize;
    while let Some(relative_start) = lower_html[offset..].find(&format!("</{tag_name}")) {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            return true;
        };
        if html_tag_name(&html[tag_start..tag_end]).as_deref() == Some(tag_name) {
            return true;
        }
        offset = tag_end;
    }
    false
}

pub(crate) fn sanitize_raw_markdown_html_tag(tag: &str) -> String {
    let Some(tag_name) = html_tag_name(tag) else {
        return String::new();
    };

    if !is_allowed_raw_markdown_html_tag(&tag_name) {
        return String::new();
    }

    if is_html_closing_tag(tag) {
        return format!("</{tag_name}>");
    }

    let mut sanitized = String::from("<");
    sanitized.push_str(&tag_name);

    for attribute_name in allowed_raw_markdown_html_attributes(&tag_name) {
        let Some(attribute) = find_html_attribute(tag, attribute_name) else {
            continue;
        };
        let Some(attribute_value) =
            sanitized_raw_markdown_html_attribute_value(attribute_name, attribute.value)
        else {
            continue;
        };
        sanitized.push(' ');
        sanitized.push_str(attribute_name);
        sanitized.push_str("=\"");
        sanitized.push_str(&encode_double_quoted_attribute(&attribute_value));
        sanitized.push('"');
    }

    // Boolean attributes (e.g. `<details open>`) carry no value; emit them bare
    // when present so a collapsible block keeps its expanded state.
    for attribute_name in allowed_raw_markdown_html_boolean_attributes(&tag_name) {
        if html_has_boolean_attribute(tag, attribute_name) {
            sanitized.push(' ');
            sanitized.push_str(attribute_name);
        }
    }

    if is_html_self_closing_tag(tag) {
        sanitized.push_str(" />");
    } else {
        sanitized.push('>');
    }

    sanitized
}

pub(crate) fn is_allowed_raw_markdown_html_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "p" | "br"
            | "hr"
            | "a"
            | "strong"
            | "em"
            | "del"
            | "code"
            | "pre"
            | "img"
            | "ul"
            | "ol"
            | "li"
            | "blockquote"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "div"
            | "span"
            | "table"
            | "thead"
            | "tbody"
            | "tr"
            | "td"
            | "th"
            // Collapsible sections, common in GitHub READMEs.
            | "details"
            | "summary"
            // Safe semantic/formatting inline elements (no scripting or loads).
            | "kbd"
            | "sub"
            | "sup"
            | "mark"
            | "ins"
            | "s"
            | "abbr"
            | "dl"
            | "dt"
            | "dd"
            | "figure"
            | "figcaption"
    )
}

pub(crate) fn allowed_raw_markdown_html_attributes(tag_name: &str) -> &'static [&'static str] {
    match tag_name {
        "a" => &["href", "title", "id", "name"],
        "img" => &["src", "alt", "title"],
        "div" | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => &["align", "id"],
        "span" => &["id"],
        "td" | "th" => &["align", "colspan"],
        "abbr" => &["title"],
        _ => &[],
    }
}

/// Boolean attributes kept when present (e.g. `open` on `<details>`), emitted bare.
pub(crate) fn allowed_raw_markdown_html_boolean_attributes(
    tag_name: &str,
) -> &'static [&'static str] {
    match tag_name {
        "details" => &["open"],
        _ => &[],
    }
}

pub(crate) fn sanitized_raw_markdown_html_attribute_value(
    attribute_name: &str,
    value: &str,
) -> Option<String> {
    match attribute_name {
        "href" | "src" => is_safe_raw_markdown_html_url(value).then(|| value.to_string()),
        "align" => sanitize_raw_markdown_html_align_value(value),
        _ => Some(value.to_string()),
    }
}

pub(crate) fn sanitize_raw_markdown_html_align_value(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    matches!(normalized.as_str(), "left" | "center" | "right" | "justify").then_some(normalized)
}

pub(crate) fn is_safe_raw_markdown_html_url(value: &str) -> bool {
    match Url::parse(value) {
        Ok(url) => matches!(url.scheme(), "http" | "https" | "mailto" | "file"),
        Err(url::ParseError::RelativeUrlWithoutBase) => true,
        Err(_) => false,
    }
}

pub(crate) fn resolve_img_tag_src(tag: &str, source_path: &Path) -> String {
    let Some(attribute) = find_html_attribute(tag, "src") else {
        return tag.to_string();
    };
    if local_image_source_dir(source_path).is_none()
        && is_safe_relative_image_destination(attribute.value)
    {
        return tag.to_string();
    }
    let resolved_src = resolve_image_destination(attribute.value, source_path)
        .unwrap_or_else(|| "javascript:leaf-blocked".to_string());

    let mut resolved = String::with_capacity(tag.len() + resolved_src.len());
    resolved.push_str(&tag[..attribute.replacement_start]);
    if attribute.was_quoted {
        resolved.push_str(&encode_double_quoted_attribute(&resolved_src));
    } else {
        resolved.push('"');
        resolved.push_str(&encode_double_quoted_attribute(&resolved_src));
        resolved.push('"');
    }
    resolved.push_str(&tag[attribute.replacement_end..]);
    resolved
}

pub(crate) fn sanitize_rendered_html(html: &str) -> String {
    let mut sanitizer = Builder::new();
    configure_rendered_html_sanitizer(&mut sanitizer);
    sanitizer.clean(html).to_string()
}

/// The URL schemes rendered HTML may keep. One list, shared with the email
/// renderer, which adds only `cid:` on top of it.
pub(crate) const RENDERED_HTML_URL_SCHEMES: [&str; 5] =
    ["http", "https", "mailto", "glossary", LOCAL_IMAGE_PROTOCOL];

pub(crate) fn configure_rendered_html_sanitizer(sanitizer: &mut Builder<'_>) {
    sanitizer
        .url_schemes(RENDERED_HTML_URL_SCHEMES.into_iter().collect())
        .add_tags(&["input"])
        .add_tag_attributes("a", &["aria-label", "class", "id", "name"])
        .add_tag_attributes("blockquote", &["class"])
        .add_tag_attributes("div", &["align", "class", "id"])
        .add_tag_attributes("code", &["class"])
        .add_tag_attributes("abbr", &["title"])
        .add_tag_attributes("details", &["open"])
        .add_tag_attributes("h1", &["align", "id"])
        .add_tag_attributes("h2", &["align", "id"])
        .add_tag_attributes("h3", &["align", "id"])
        .add_tag_attributes("h4", &["align", "id"])
        .add_tag_attributes("h5", &["align", "id"])
        .add_tag_attributes("h6", &["align", "id"])
        .add_tag_attributes("img", &["alt", "src", "title"])
        .add_tag_attributes("p", &["align", "id"])
        .add_tag_attributes("pre", &["class", "data-language"])
        .add_tag_attributes("span", &["aria-label", "class", "id", "title"])
        .add_tag_attributes("sup", &["class", "id"])
        .add_tags(&["svg", "path"])
        .add_tag_attributes("svg", &["aria-hidden", "focusable", "viewBox", "xmlns"])
        .add_tag_attributes(
            "path",
            &[
                "d",
                "fill",
                "stroke",
                "stroke-linecap",
                "stroke-linejoin",
                "stroke-width",
            ],
        )
        .add_tag_attributes("input", &["checked", "disabled", "type"])
        .add_tag_attributes("td", &["align", "colspan"])
        .add_tag_attributes("th", &["align", "colspan"])
        // Editing-model block markers (`data-leaf-*`, `data-src-*`): no script,
        // never a URL context, so allowed on every tag.
        .add_generic_attribute_prefixes(&["data-leaf-", "data-src-"]);
}
