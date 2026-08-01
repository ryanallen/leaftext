//! Document-to-document links and how their targets resolve.

use super::*;

/// One outgoing link. Exactly one hint is set: `target_abs` (a resolved absolute
/// path), `target_name` (a `[[wiki]]` note name), or `target_url` (a web address).
/// The first two are matched to a document at graph-build time, so dangling links
/// persist without rewriting; a URL needs no matching — it is its own node.
#[derive(Debug, Clone, PartialEq)]
pub struct DocLink {
    pub target_abs: Option<String>,
    pub target_name: Option<String>,
    /// An `http`/`https` address, in [`normalize_url`] form so that two documents
    /// citing one page point at one node.
    pub target_url: Option<String>,
    pub raw: String,
    /// Byte range of the link in the source, where the scan knows it — the whole
    /// `[text](url)` or `[[name]]`, or an attribute's value. The code view's
    /// broken-link underline draws over exactly this range; `None` draws nothing.
    pub span: Option<(usize, usize)>,
}

/// Extract a document's outgoing links, dispatching on file type. Markdown gets
/// Markdown links, `<a href>`, and `[[wiki]]`; XML gets `target=`/`href=` attrs.
/// Deduplicated by resolved target so a repeated link draws one edge.
pub(crate) fn document_links(content: &str, source_abs: &Path) -> Vec<DocLink> {
    let mut links = match DocumentFormat::from_path(source_abs) {
        DocumentFormat::Xml => xml_links(content, source_abs),
        // A data file's strings are values, not prose. Scanning them as Markdown
        // invents links that were never written, so the graph leaves them out.
        // Mail bodies are transfer-encoded — the scan would read base64, not
        // links — so messages stay out too.
        DocumentFormat::Json | DocumentFormat::Yaml | DocumentFormat::Eml => Vec::new(),
        DocumentFormat::Markdown => markdown_links(content, source_abs),
    };
    dedup_links(&mut links);
    links
}

fn dedup_links(links: &mut Vec<DocLink>) {
    let mut seen: HashSet<(Option<String>, Option<String>, Option<String>)> = HashSet::new();
    links.retain(|link| {
        seen.insert((
            link.target_abs.clone(),
            link.target_name.clone(),
            link.target_url.clone(),
        ))
    });
}

/// Markdown link destinations come from the parser; `<a href>` and `[[wiki]]`
/// aren't link tags, so they're scanned from the source separately.
///
/// Bare URLs are neither. They are not links in the source at all — the renderer
/// finds them in the plain text and makes them links there — so the graph walks the
/// text the same way and asks the same finder, because a link the reader can click
/// is a link.
fn markdown_links(content: &str, source_abs: &Path) -> Vec<DocLink> {
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};
    let mut out = Vec::new();
    // Text inside a link is that link's label, not somewhere to look for another
    // one — the same reason the renderer's linkifier tracks this.
    let mut link_depth = 0usize;
    for (event, range) in Parser::new(content).into_offset_iter() {
        match event {
            Event::Start(Tag::Link { dest_url, .. }) => {
                link_depth += 1;
                push_target(
                    &mut out,
                    &dest_url,
                    source_abs,
                    Some((range.start, range.end)),
                );
            }
            // An image is not a link to a document, so its destination is not a
            // target — but its alt text is still inside it.
            Event::Start(Tag::Image { .. }) => link_depth += 1,
            Event::End(TagEnd::Link) | Event::End(TagEnd::Image) => {
                link_depth = link_depth.saturating_sub(1);
            }
            Event::Text(text) if link_depth == 0 => {
                for url in crate::plain_text_urls(text.as_ref()) {
                    push_url(&mut out, url, None);
                }
            }
            _ => {}
        }
    }
    collect_attr_targets(content, "href", source_abs, &mut out);
    collect_wiki_links(content, &mut out);
    out
}

/// TEI cross-references live in `target=` (`<ref>`, `<ptr>`) and `href=` (`<a>`)
/// attributes.
fn xml_links(content: &str, source_abs: &Path) -> Vec<DocLink> {
    let mut out = Vec::new();
    collect_attr_targets(content, "target", source_abs, &mut out);
    collect_attr_targets(content, "href", source_abs, &mut out);
    out
}

/// Push one link destination: a web address as itself, anything else resolved as a
/// path relative to the document.
///
/// Empty and anchor-only (`#section`) destinations are neither — the second points
/// inside the document it is written in, and a document is one node.
fn push_target(out: &mut Vec<DocLink>, raw: &str, source_abs: &Path, span: Option<(usize, usize)>) {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return;
    }
    if crate::starts_with_url_scheme(trimmed) {
        push_url(out, trimmed.to_string(), span);
        return;
    }
    // Some other scheme — `mailto:`, `file:`, `leaf-image:`, anything custom.
    // Not an address a map can go to, and not a path either.
    if has_url_scheme(trimmed) {
        return;
    }
    if let Some(abs) = resolve_path_target(trimmed, source_abs) {
        out.push(DocLink {
            target_abs: Some(abs),
            target_name: None,
            target_url: None,
            raw: trimmed.to_string(),
            span,
        });
    }
}

fn push_url(out: &mut Vec<DocLink>, url: String, span: Option<(usize, usize)>) {
    out.push(DocLink {
        target_abs: None,
        target_name: None,
        target_url: Some(normalize_url(&url)),
        raw: url,
        span,
    });
}

/// The form two references to one page agree on: no `#fragment`, no trailing slash,
/// and the scheme and host lowercased — those are case-insensitive, the path is not.
/// So three notes citing one article share one node instead of drawing three.
pub fn normalize_url(url: &str) -> String {
    let trimmed = url.split('#').next().unwrap_or(url);
    let trimmed = trimmed.strip_suffix('/').unwrap_or(trimmed);
    match split_url_authority(trimmed) {
        Some((authority, tail)) => format!("{authority}{tail}"),
        None => trimmed.to_string(),
    }
}

/// What a web address is called under its node: the host, without `www.`. The whole
/// URL stays the node's identity and its tooltip — a domain is what fits on screen,
/// and what tells you at a glance that this one is not your document.
pub fn url_host_label(url: &str) -> String {
    let Some((authority, _)) = split_url_authority(url) else {
        return url.to_string();
    };
    let host = match authority.split_once("://") {
        Some((_, host)) => host,
        None => authority.as_str(),
    };
    // `user:pass@host:port` — neither half is a name worth showing.
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    let label = host.strip_prefix("www.").unwrap_or(host);
    if label.is_empty() {
        url.to_string()
    } else {
        label.to_string()
    }
}

/// Split an `http`/`https` URL into a lowercased `scheme://host` and everything
/// after it. `None` for anything not shaped like one.
fn split_url_authority(url: &str) -> Option<(String, &str)> {
    let (scheme, rest) = url.split_once("://")?;
    let end = rest.find(['/', '?']).unwrap_or(rest.len());
    let (host, tail) = rest.split_at(end);
    Some((
        format!("{}://{}", scheme.to_lowercase(), host.to_lowercase()),
        tail,
    ))
}

/// Scan for `<... attr="value" ...>` and push each value as a path target. A
/// lexical scan, not a full parse: enough for the anchor/ref/ptr elements used.
fn collect_attr_targets(content: &str, attr: &str, source_abs: &Path, out: &mut Vec<DocLink>) {
    let needle = format!("{attr}=");
    let bytes = content.as_bytes();
    let mut search_from = 0;
    while let Some(rel) = content[search_from..].find(&needle) {
        let eq = search_from + rel + needle.len();
        // The char before the attribute name must be a tag delimiter (space, '<',
        // '/', or a quote) so `data-href=` / `xtarget=` do not match `href=` /
        // `target=`.
        let start = search_from + rel;
        let boundary_ok = start == 0
            || matches!(
                bytes[start - 1],
                b' ' | b'\t' | b'\n' | b'\r' | b'<' | b'/' | b'"' | b'\''
            );
        search_from = eq;
        if !boundary_ok || eq >= bytes.len() {
            continue;
        }
        let quote = bytes[eq];
        if quote != b'"' && quote != b'\'' {
            continue;
        }
        let value_start = eq + 1;
        if let Some(end_rel) = content[value_start..].find(quote as char) {
            let value = &content[value_start..value_start + end_rel];
            search_from = value_start + end_rel + 1;
            push_target(
                out,
                value,
                source_abs,
                Some((value_start, value_start + end_rel)),
            );
        }
    }
}

/// Scan for `[[Note]]`, `[[Note|alias]]`, and `[[Note#heading]]` wiki links and
/// push the note name (before any `|` or `#`) as a name target.
fn collect_wiki_links(content: &str, out: &mut Vec<DocLink>) {
    let mut search_from = 0;
    while let Some(rel) = content[search_from..].find("[[") {
        let open = search_from + rel + 2;
        let Some(close_rel) = content[open..].find("]]") else {
            break;
        };
        let inner = &content[open..open + close_rel];
        search_from = open + close_rel + 2;
        if inner.contains('\n') {
            continue;
        }
        let name = inner.split(['|', '#']).next().unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        out.push(DocLink {
            target_abs: None,
            target_name: Some(normalize_name_key(name)),
            target_url: None,
            raw: format!("[[{inner}]]"),
            span: Some((open - 2, open + close_rel + 2)),
        });
    }
}

/// True when `target` begins with a URL scheme (not a local document). Requires
/// 2+ scheme chars so a Windows drive path (`C:\...`) reads as a path, not a URL.
pub(super) fn has_url_scheme(target: &str) -> bool {
    let bytes = target.as_bytes();
    for (i, &c) in bytes.iter().enumerate() {
        if c == b':' {
            return i >= 2;
        }
        let scheme_char = c.is_ascii_alphabetic()
            || (i > 0 && (c.is_ascii_digit() || c == b'+' || c == b'-' || c == b'.'));
        if !scheme_char {
            return false;
        }
    }
    false
}

/// Resolve a relative link target to an absolute path string, stripping
/// `#fragment`/`?query` and percent-decoding. `None` for path-less targets.
fn resolve_path_target(raw: &str, source_abs: &Path) -> Option<String> {
    let without_fragment = raw.split(['#', '?']).next().unwrap_or("").trim();
    if without_fragment.is_empty() {
        return None;
    }
    let decoded = percent_decode(without_fragment);
    let base = source_abs.parent()?;
    Some(normalize_join(base, &decoded))
}

/// Lexically join `rel` onto `base`, resolving `.`/`..` without touching the
/// filesystem (the target may not exist yet). Absolute `rel` replaces `base`.
fn normalize_join(base: &Path, rel: &str) -> String {
    use std::path::Component;
    let rel_path = Path::new(rel);
    let mut result = if rel_path.is_absolute() {
        PathBuf::new()
    } else {
        base.to_path_buf()
    };
    for component in rel_path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            Component::Normal(part) => result.push(part),
            Component::RootDir => {}
            Component::Prefix(prefix) => result = PathBuf::from(prefix.as_os_str()),
        }
    }
    path_to_string(&result)
}

/// Decode `%XX` escapes in a link target (e.g. `My%20Note.md` -> `My Note.md`),
/// leaving anything that is not a valid escape untouched.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Normalize a note name (wiki link text, or a file's own name) to the key both
/// sides match on: trimmed and lowercased.
pub(crate) fn normalize_name_key(name: &str) -> String {
    name.trim().to_lowercase()
}
