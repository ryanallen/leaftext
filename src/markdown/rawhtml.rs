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

    // Boolean attributes (e.g. `<details open>`) carry no value; emit them bare when present so a collapsible block keeps its expanded state.
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

pub(crate) fn resolve_img_tag_src(tag: &str, source_path: &Path, host: &dyn LeafHost) -> String {
    let Some(attribute) = find_html_attribute(tag, "src") else {
        return tag.to_string();
    };
    // Left exactly as it was written when there is nothing to rewrite it against: no folder to resolve from, or a host that serves no folder of its own and does not say where it serves the document's neighbors from — a document inside somebody else's page, where the path beside the document is already the path the page fetches.
    let nothing_to_rewrite_against = if host.serves_local_images() {
        local_image_source_dir(source_path).is_none()
    } else {
        host.served_documents_url().is_none()
    };
    if nothing_to_rewrite_against && is_safe_relative_image_destination(attribute.value) {
        return tag.to_string();
    }
    let resolved_src = resolve_image_destination(attribute.value, source_path, host)
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

/// A whole path written from a drive letter — `C:/notes/plan.md`, or the same with backslashes — rewritten as the `file:` address the grant below is written for.
///
/// The sanitizer parses an address before it judges it, so a path starting from a drive letter arrives carrying that letter as its scheme and the scheme list can never reach it. Rewritten here rather than admitting twenty-six letters to that list, which would admit anything at all after the colon — and rewritten to the one shape everything downstream already reads: the page's own `file:` arm, the host's resolver, and the confirmation before a link the system would run.
pub(crate) fn drive_letter_hrefs_as_file_urls(html: &str) -> String {
    let mut rewritten = String::with_capacity(html.len());
    let mut offset = 0usize;
    let lower_html = html.to_ascii_lowercase();

    while let Some(relative_start) = lower_html[offset..].find("<a") {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            break;
        };

        rewritten.push_str(&html[offset..tag_start]);
        rewritten.push_str(&rewrite_drive_letter_href(&html[tag_start..tag_end]));
        offset = tag_end;
    }

    rewritten.push_str(&html[offset..]);
    rewritten
}

fn rewrite_drive_letter_href(tag: &str) -> String {
    let Some(attribute) = find_html_attribute(tag, "href") else {
        return tag.to_string();
    };
    let Some(url) = file_url_from_drive_letter_path(attribute.value) else {
        return tag.to_string();
    };
    let mut out = String::with_capacity(tag.len() + url.len());
    out.push_str(&tag[..attribute.replacement_start]);
    // Quoted on the way out where the address it replaces was not: the value it stands in for is a path, and a bare one would end on the first space.
    if attribute.was_quoted {
        out.push_str(&encode_double_quoted_attribute(&url));
    } else {
        out.push('"');
        out.push_str(&encode_double_quoted_attribute(&url));
        out.push('"');
    }
    out.push_str(&tag[attribute.replacement_end..]);
    out
}

/// `C:\notes\plan.md` and `C:/notes/plan.md` alike as `file:///C:/notes/plan.md`. A drive-relative `C:plan.md` is not a whole path and is left where it is.
///
/// The separator arrives written three ways: a forward slash, a backslash, and the `%5C` the renderer writes a backslash out as. All three become the one the URL parser reads.
pub(crate) fn file_url_from_drive_letter_path(value: &str) -> Option<String> {
    let mut characters = value.char_indices();
    let (_, drive) = characters.next()?;
    if !drive.is_ascii_alphabetic() || characters.next()?.1 != ':' {
        return None;
    }
    let (rest_at, _) = characters.next()?;
    let rest = &value[rest_at..];
    let separated =
        rest.starts_with(['/', '\\']) || rest.len() >= 3 && rest[..3].eq_ignore_ascii_case("%5c");
    if !separated {
        return None;
    }
    let path = rest
        .replace('\\', "/")
        .replace("%5C", "/")
        .replace("%5c", "/");
    Some(format!("file:///{}:{path}", drive))
}

pub(crate) fn sanitize_rendered_html(html: &str) -> String {
    let mut sanitizer = Builder::new();
    configure_rendered_html_sanitizer(&mut sanitizer);
    sanitizer.clean(html).to_string()
}

/// The URL schemes rendered HTML may keep. One list, shared with the email renderer, which adds only `cid:` on top of it.
///
/// `file` is here so a document may name a file on this disk and a click on it goes where a click on a relative link goes. The gate for raw HTML written inside Markdown has allowed it all along, so this is the two lists agreeing rather than a new door. An address naming somebody else's program — `obsidian:`, `zotero:` — and a phone number stay off it: handing a stranger's document a line to another program is its own decision, and a link that loses its address now says so in the window rather than doing nothing.
pub(crate) const RENDERED_HTML_URL_SCHEMES: [&str; 6] = [
    "http",
    "https",
    "mailto",
    "glossary",
    "file",
    LOCAL_IMAGE_PROTOCOL,
];

pub(crate) fn configure_rendered_html_sanitizer(sanitizer: &mut Builder<'_>) {
    sanitizer
        .url_schemes(RENDERED_HTML_URL_SCHEMES.into_iter().collect())
        .clean_content_tags(["script", "style", "title"].into_iter().collect())
        .add_tags(&["input", "main", "section"])
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
        // Editing-model block markers (`data-leaf-*`, `data-src-*`): no script, never a URL context, so allowed on every tag.
        .add_generic_attribute_prefixes(&["data-leaf-", "data-src-"]);
}

/// Whether a raw HTML block reaches the page as no element: every tag in it is a comment, which the sanitizer above strips (`strip_comments` is ammonia's default and is never turned off), or a `script`/`style`, which goes with its contents. Text beside a comment counts as nothing too — a text node is not an element a source range can be stamped on.
///
/// A closing `</div>` is not this case: its tag survives, and the page steps over it as the structural half of a wrapper.
pub(crate) fn html_block_renders_to_no_element(source: &str) -> bool {
    let mut rest = source;

    while let Some(open) = rest.find('<') {
        let tail = &rest[open..];

        if let Some(after_open) = tail.strip_prefix("<!--") {
            // Unterminated, it is escaped into the page as text rather than drawn — still nothing to stamp.
            let Some(close) = after_open.find("-->") else {
                return true;
            };
            rest = &after_open[close + "-->".len()..];
            continue;
        }

        let Some(tag_end) = find_html_tag_end(tail, 0) else {
            return false;
        };
        let tag = &tail[..tag_end];
        let Some(tag_name) = html_tag_name(tag) else {
            return false;
        };
        if !matches!(tag_name.as_str(), "script" | "style") || is_html_closing_tag(tag) {
            return false;
        }

        // Unclosed, the removal swallows the rest of the block — [`sanitize_raw_markdown_html_fragment`] stops in the same place.
        let lower_tail = tail.to_ascii_lowercase();
        let Some(close_start) = lower_tail[tag_end..].find(&format!("</{tag_name}")) else {
            return true;
        };
        let Some(close_end) = find_html_tag_end(tail, tag_end + close_start) else {
            return true;
        };
        rest = &tail[close_end..];
    }

    true
}
