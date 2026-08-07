//! Resolving the URL a Markdown or HTML image points at.

use super::*;

pub(crate) fn resolve_absolute_markdown_image_urls(
    events: Vec<Event<'static>>,
    source_path: &Path,
) -> Vec<Event<'static>> {
    events
        .into_iter()
        .map(|event| match event {
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) => {
                let resolved = markdown_image_destination_for_html(dest_url.as_ref(), source_path)
                    .map_or(dest_url, |url| cowstr(&url));

                Event::Start(Tag::Image {
                    link_type,
                    dest_url: resolved,
                    title,
                    id,
                })
            }
            _ => event,
        })
        .collect()
}

/// Copy an image's alt text into its `title` attribute when no explicit title is set, so hovering the image shows the alt text as a native tooltip.
pub(crate) fn fill_image_titles_from_alt(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut transformed: Vec<Event<'static>> = Vec::with_capacity(events.len());

    for (index, event) in events.iter().enumerate() {
        match event {
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) if title.is_empty() => {
                let alt = collect_image_alt_text(&events[index + 1..]);
                transformed.push(Event::Start(Tag::Image {
                    link_type: *link_type,
                    dest_url: dest_url.clone(),
                    title: cowstr(&alt),
                    id: id.clone(),
                }));
            }
            _ => transformed.push(event.clone()),
        }
    }

    transformed
}

/// Gather the plain text inside an image (its alt text) up to the closing image tag. `events` starts just after the image's start tag.
pub(crate) fn collect_image_alt_text(events: &[Event<'static>]) -> String {
    let mut alt = String::new();

    for event in events {
        match event {
            Event::End(TagEnd::Image) => break,
            Event::Text(text) | Event::Code(text) => alt.push_str(text),
            _ => {}
        }
    }

    alt
}

pub(crate) fn markdown_image_destination_for_html(
    destination: &str,
    source_path: &Path,
) -> Option<String> {
    if let Some(badge_url) = github_actions_badge_fallback_url(destination) {
        return Some(badge_url);
    }

    let source_dir = local_image_source_dir(source_path)?;

    if Path::new(destination).is_absolute() {
        return local_image_relative_url_for_path(Path::new(destination), &source_dir);
    }

    if let Ok(url) = Url::parse(destination) {
        if url.scheme() == "file" {
            return path_from_file_url(&url)
                .and_then(|path| local_image_relative_url_for_path(&path, &source_dir));
        }
    }

    None
}

pub(crate) fn github_actions_badge_fallback_url(destination: &str) -> Option<String> {
    let url = Url::parse(destination).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str() != Some("github.com") {
        return None;
    }

    let segments: Vec<&str> = url.path_segments()?.collect();
    let [owner, repo, "actions", "workflows", workflow, "badge.svg"] = segments.as_slice() else {
        return None;
    };

    let mut fallback = Url::parse("https://img.shields.io").ok()?;
    fallback.path_segments_mut().ok()?.extend([
        "github", "actions", "workflow", "status", owner, repo, workflow,
    ]);

    {
        let mut query = fallback.query_pairs_mut();
        query.append_pair("label", &github_actions_badge_label(workflow));
    }

    Some(fallback.to_string())
}

pub(crate) fn github_actions_badge_label(workflow: &str) -> String {
    let stem = workflow
        .strip_suffix(".yml")
        .or_else(|| workflow.strip_suffix(".yaml"))
        .unwrap_or(workflow);

    stem.split(['-', '_', '.'])
        .filter(|word| !word.is_empty())
        .map(|word| match word.to_ascii_lowercase().as_str() {
            "ci" => "CI".to_string(),
            "qemu" => "QEMU".to_string(),
            _ => {
                let mut chars = word.chars();
                chars
                    .next()
                    .map(|first| {
                        first
                            .to_uppercase()
                            .chain(chars.flat_map(char::to_lowercase))
                            .collect()
                    })
                    .unwrap_or_default()
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

pub(crate) fn resolve_image_destination(destination: &str, source_path: &Path) -> Option<String> {
    if destination.is_empty() || destination.starts_with('#') || destination.starts_with("//") {
        return None;
    }

    if let Some(url) = parse_image_destination_url(destination) {
        return match url.scheme() {
            "http" | "https" => Some(url.to_string()),
            "file" => path_from_file_url(&url)
                .and_then(|path| local_image_url_for_absolute_path(&path, source_path)),
            _ => None,
        };
    }

    if Path::new(destination).is_absolute() {
        let path = local_image_destination_path(destination)?;
        return local_image_url_for_absolute_path(&path, source_path);
    }

    let source_dir = local_image_source_dir(source_path)?;

    local_image_protocol_url_for_relative_destination(destination, &source_dir)
}

/// What to write into a document for an image the user just picked off their disk: relative to the document's own folder when it sits under it, so the pair still resolve after both are moved or shared, and absolute otherwise (which the resolver above already reads). A destination holding a space or a bracket is wrapped in `<>`, the CommonMark form for one — without it a picture in `My Photos` would end at the space.
pub fn markdown_image_insert_destination(image: &Path, source_path: &Path) -> String {
    let relative = local_image_source_dir(source_path).and_then(|dir| {
        normalize_path_lexically(image)
            .strip_prefix(&dir)
            .ok()
            .map(|rest| {
                rest.components()
                    .map(|part| part.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/")
            })
    });
    let destination = match relative {
        Some(rest) if !rest.is_empty() => rest,
        _ => image.display().to_string(),
    };
    if destination.contains([' ', '(', ')', '<', '>']) {
        format!("<{destination}>")
    } else {
        destination
    }
}

/// Parse a destination as a URL, except when the "scheme" is a lone letter — that is a Windows drive (`C:\imgs\pic.png`), which is a path, not a URL.
pub(crate) fn parse_image_destination_url(destination: &str) -> Option<Url> {
    let url = Url::parse(destination).ok()?;
    (url.scheme().len() > 1).then_some(url)
}

pub(crate) fn local_image_url_for_absolute_path(path: &Path, source_path: &Path) -> Option<String> {
    match local_image_source_dir(source_path) {
        Some(source_dir) => local_image_protocol_url_for_path(path, &source_dir),
        None => local_image_protocol_url_for_absolute_path(path),
    }
}

pub(crate) fn is_safe_relative_image_destination(destination: &str) -> bool {
    if destination.is_empty() || destination.starts_with('#') || destination.starts_with("//") {
        return false;
    }

    matches!(
        Url::parse(destination),
        Err(url::ParseError::RelativeUrlWithoutBase)
    )
}

/// A diagram box can carry a picture — `B@{ img: "shot.png" }` — and the web view has no idea where the document is, so a path beside it means nothing there. Resolved with the same function a Markdown image goes through, so both spellings of "the picture next to this file" reach the page as one URL. Only inside `@{ … }` and only that key: the same word in a label is the reader's own text. Neither editor sees this — both read the block out of the file, never the page.
pub(crate) fn resolve_mermaid_image_destinations(code: &str, source_path: &Path) -> String {
    if !code.contains("@{") {
        return code.to_string();
    }
    let mut resolved = String::with_capacity(code.len());
    let mut rest = code;
    while let Some(open) = rest.find("@{") {
        resolved.push_str(&rest[..open + 2]);
        let body = &rest[open + 2..];
        let Some(close) = mermaid_typed_body_end(body) else {
            resolved.push_str(body);
            return resolved;
        };
        resolved.push_str(&resolve_mermaid_typed_body(&body[..close], source_path));
        resolved.push('}');
        rest = &body[close + 1..];
    }
    resolved.push_str(rest);
    resolved
}

/// The `}` that closes `@{`, skipping any inside a quoted label — a label may hold the brace and the comma the braces out here are made of.
fn mermaid_typed_body_end(body: &str) -> Option<usize> {
    let mut quoted = false;
    for (at, character) in body.char_indices() {
        match character {
            '"' => quoted = !quoted,
            '}' if !quoted => return Some(at),
            _ => {}
        }
    }
    None
}

fn resolve_mermaid_typed_body(body: &str, source_path: &Path) -> String {
    let mut parts = Vec::new();
    let mut quoted = false;
    let mut start = 0usize;
    for (at, character) in body.char_indices() {
        match character {
            '"' => quoted = !quoted,
            ',' if !quoted => {
                parts.push(&body[start..at]);
                start = at + 1;
            }
            _ => {}
        }
    }
    parts.push(&body[start..]);
    parts
        .into_iter()
        .map(|part| resolve_mermaid_typed_part(part, source_path))
        .collect::<Vec<String>>()
        .join(",")
}

fn resolve_mermaid_typed_part(part: &str, source_path: &Path) -> String {
    let Some(colon) = part.find(':') else {
        return part.to_string();
    };
    let (key, after) = part.split_at(colon);
    if key.trim() != "img" {
        return part.to_string();
    }
    let value = &after[1..];
    let bare = value.trim();
    let quoted = bare.len() >= 2 && bare.starts_with('"') && bare.ends_with('"');
    let destination = if quoted {
        &bare[1..bare.len() - 1]
    } else {
        bare
    };
    let Some(url) = resolve_image_destination(destination, source_path) else {
        return part.to_string();
    };
    // Always quoted on the way out: a resolved URL can hold the comma or the brace a bare value would end on.
    let gap = &value[..value.len() - value.trim_start().len()];
    format!("{key}:{gap}\"{url}\"")
}

pub(crate) fn resolve_rendered_html_image_urls(html: &str, source_path: &Path) -> String {
    let mut resolved = String::with_capacity(html.len());
    let mut offset = 0usize;
    let lower_html = html.to_ascii_lowercase();

    while let Some(relative_start) = lower_html[offset..].find("<img") {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            break;
        };

        resolved.push_str(&html[offset..tag_start]);
        resolved.push_str(&resolve_img_tag_src(&html[tag_start..tag_end], source_path));
        offset = tag_end;
    }

    resolved.push_str(&html[offset..]);
    resolved
}
