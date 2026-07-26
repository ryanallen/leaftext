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

/// Copy an image's alt text into its `title` attribute when no explicit title
/// is set, so hovering the image shows the alt text as a native tooltip.
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

/// Gather the plain text inside an image (its alt text) up to the closing image
/// tag. `events` starts just after the image's start tag.
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
            return url
                .to_file_path()
                .ok()
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
            "file" => url
                .to_file_path()
                .ok()
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

/// Parse a destination as a URL, except when the "scheme" is a lone letter — that
/// is a Windows drive (`C:\imgs\pic.png`), which is a path, not a URL.
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
