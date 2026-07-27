//! Document-to-document links and how their targets resolve.

use super::*;

/// One outgoing link. Exactly one hint is set: `target_abs` (a resolved absolute
/// path) or `target_name` (a `[[wiki]]` note name). Both are matched to a file id
/// at graph-build time, so dangling links persist without rewriting.
#[derive(Debug, Clone, PartialEq)]
pub struct DocLink {
    pub target_abs: Option<String>,
    pub target_name: Option<String>,
    pub raw: String,
}

/// Extract a document's outgoing links, dispatching on file type. Markdown gets
/// Markdown links, `<a href>`, and `[[wiki]]`; XML gets `target=`/`href=` attrs.
/// Deduplicated by resolved target so a repeated link draws one edge.
pub(crate) fn document_links(content: &str, source_abs: &Path) -> Vec<DocLink> {
    let mut links = match DocumentFormat::from_path(source_abs) {
        DocumentFormat::Xml => xml_links(content, source_abs),
        // A data file's strings are values, not prose. Scanning them as Markdown
        // invents links that were never written, so the graph leaves them out.
        DocumentFormat::Json | DocumentFormat::Yaml => Vec::new(),
        DocumentFormat::Markdown => markdown_links(content, source_abs),
    };
    dedup_links(&mut links);
    links
}

fn dedup_links(links: &mut Vec<DocLink>) {
    let mut seen: HashSet<(Option<String>, Option<String>)> = HashSet::new();
    links.retain(|link| seen.insert((link.target_abs.clone(), link.target_name.clone())));
}

/// Markdown link destinations come from the parser; `<a href>` and `[[wiki]]`
/// aren't link tags, so they're scanned from the source separately.
fn markdown_links(content: &str, source_abs: &Path) -> Vec<DocLink> {
    use pulldown_cmark::{Event, Parser, Tag};
    let mut out = Vec::new();
    for event in Parser::new(content) {
        if let Event::Start(Tag::Link { dest_url, .. }) = event {
            push_path_target(&mut out, &dest_url, source_abs);
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

/// Push a resolved path link, skipping empty, anchor-only, and external-URL
/// targets (those never point at a local document).
fn push_path_target(out: &mut Vec<DocLink>, raw: &str, source_abs: &Path) {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || has_url_scheme(trimmed) {
        return;
    }
    if let Some(abs) = resolve_path_target(trimmed, source_abs) {
        out.push(DocLink {
            target_abs: Some(abs),
            target_name: None,
            raw: trimmed.to_string(),
        });
    }
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
            push_path_target(out, value, source_abs);
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
            raw: format!("[[{inner}]]"),
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

/// Resolve a relative link target to an absolute path string (crawl normal form),
/// stripping `#fragment`/`?query` and percent-decoding. `None` for path-less targets.
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
