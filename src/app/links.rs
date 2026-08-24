//! What a clicked href means, and where it points.

use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LinkTarget {
    AnchorOnly,
    External(String),
    /// A local file the app renders: followed in place, in the current tab.
    LocalDocument(String),
    /// A local file the app doesn't render: resolved against the open document, then handed to the OS.
    LocalFile(String),
    /// An href naming a scheme this app has no answer for: handed to the OS as written, because reading the address is that handler's job and not this one's.
    ForeignScheme(String),
}

pub(crate) fn classify_link_target(href: &str) -> LinkTarget {
    let href = href.trim();
    if href.is_empty() || href.starts_with('#') || is_relative_same_document_fragment(href) {
        return LinkTarget::AnchorOnly;
    }

    if is_external_link(href) {
        return LinkTarget::External(href.to_string());
    }

    if is_document_link(href) {
        LinkTarget::LocalDocument(href.to_string())
    } else if href_names_a_scheme(href) {
        LinkTarget::ForeignScheme(href.to_string())
    } else {
        LinkTarget::LocalFile(href.to_string())
    }
}

/// Whether an href names a scheme of its own rather than a path. Broader than `is_external_link`, which answers a fixed four; this is the question the page already asks before it calls a link an app command. `file:` is not one of them — it names a local file, which is resolved here like any other — and a single letter is a Windows drive rather than a scheme, so a path written from a drive letter reads as the path it is.
pub(crate) fn href_names_a_scheme(href: &str) -> bool {
    let Some((scheme, _)) = href.split_once(':') else {
        return false;
    };
    if scheme.len() < 2 || scheme.eq_ignore_ascii_case("file") {
        return false;
    }
    let mut letters = scheme.chars();
    letters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && letters.all(|letter| letter.is_ascii_alphanumeric() || matches!(letter, '+' | '-' | '.'))
}

/// What the system opener is handed for a link the app does not follow itself. A file beside the note is resolved against it first: the opener resolves a relative path against wherever the app was launched from, which is never where the document is, and reports success either way — so an unresolved path opens nothing and says nothing. An href carrying a scheme of its own goes out as written. `None` for a link that never leaves the app.
pub(crate) fn os_open_target(href: &str, current_path: &Path) -> Option<String> {
    match classify_link_target(href) {
        LinkTarget::External(target) | LinkTarget::ForeignScheme(target) => Some(target),
        LinkTarget::LocalFile(target) => Some(
            path_from_local_link(&target, current_path)
                .to_string_lossy()
                .into_owned(),
        ),
        LinkTarget::AnchorOnly | LinkTarget::LocalDocument(_) => None,
    }
}

pub(crate) fn is_relative_same_document_fragment(href: &str) -> bool {
    if !href.contains('#') {
        return false;
    }

    matches!(strip_query_and_fragment(href), "." | "./")
}

pub(crate) fn is_external_link(href: &str) -> bool {
    href.get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("http://"))
        || href
            .get(..8)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
        || href
            .get(..7)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("mailto:"))
        || href
            .get(..4)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("tel:"))
}

/// True when a local link points at a file the app renders, so it opens in the reading view rather than being handed to the OS. Every format, not just Markdown — otherwise a link to the `.json` beside a note leaves the app.
pub(crate) fn is_document_link(href: &str) -> bool {
    let path = local_path_from_href(href).unwrap_or_else(|| PathBuf::from(href));
    is_supported_document_path(&path)
}

/// The file a link points at, resolved against the document it sits in. `None` unless it is a local file this app reads: an external link has no path here, and an in-page jump is the document itself. Only the host can do this — the page never learns where the open document sits.
pub(crate) fn linked_document_path(href: &str, current_path: &Path) -> Option<PathBuf> {
    match classify_link_target(href) {
        LinkTarget::LocalDocument(target) => Some(path_from_local_link(&target, current_path)),
        _ => None,
    }
}

/// The resolved file a link names that is not on disk. The system opener reports success whether it opened anything or not, so a path with no file behind it goes out and says nothing at all — this is what the reader is told instead. Only a file beside the note is asked about: an address another handler reads names no file here, so a handler that is not installed fails the way it always has.
pub(crate) fn missing_linked_file(href: &str, current_path: &Path) -> Option<PathBuf> {
    match classify_link_target(href) {
        LinkTarget::LocalFile(target) => {
            let path = path_from_local_link(&target, current_path);
            (!path.exists()).then_some(path)
        }
        _ => None,
    }
}

/// The file a link points at whether or not this app reads it — what Reveal file and Copy path act on, since both are about the file rather than about where a click sends you. `linked_document_path` stays the narrower question, because the line count and the hover preview may only read a file this app renders.
pub(crate) fn linked_file_path(href: &str, current_path: &Path) -> Option<PathBuf> {
    match classify_link_target(href) {
        LinkTarget::LocalDocument(target) | LinkTarget::LocalFile(target) => {
            Some(path_from_local_link(&target, current_path))
        }
        LinkTarget::AnchorOnly | LinkTarget::External(_) | LinkTarget::ForeignScheme(_) => None,
    }
}

pub(crate) fn path_from_local_link(href: &str, current_path: &Path) -> PathBuf {
    let path =
        local_path_from_href(href).unwrap_or_else(|| PathBuf::from(strip_query_and_fragment(href)));
    if path.is_absolute() {
        normalize_path_lexically(path)
    } else {
        normalize_path_lexically(
            current_path
                .parent()
                .map_or(path.clone(), |parent| parent.join(path)),
        )
    }
}

pub(crate) fn strip_query_and_fragment(href: &str) -> &str {
    href.split(['#', '?']).next().unwrap_or(href)
}

pub(crate) fn fragment_from_href(href: &str) -> Option<String> {
    let fragment = href
        .split_once('#')?
        .1
        .split('?')
        .next()
        .unwrap_or_default();
    (!fragment.is_empty()).then(|| percent_decode_path(fragment))
}

pub(crate) fn local_path_from_href(href: &str) -> Option<PathBuf> {
    let path_text = strip_query_and_fragment(href);

    if let Ok(url) = url::Url::parse(path_text) {
        if url.scheme().eq_ignore_ascii_case("file") {
            return url.to_file_path().ok();
        }
    }

    Some(PathBuf::from(percent_decode_path(path_text)))
}

pub(crate) fn normalize_path_lexically(path: PathBuf) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

/// Whether two paths name one document. Canonicalized, so a relative path, a `..` and a Windows short name all land on the same file — two disk reads, and 22 call sites reach this.
///
/// The same bytes are answered without either, which is exact rather than an approximation: canonicalizing a path twice cannot make it differ from itself. The session saved after every event asks this for every open tab with one path and a clone of it, and every editing command asks it through `needs_edit_seed` with the buffer's path against the front tab's — 191µs an event before the guard, 1.5µs after.
pub(crate) fn paths_refer_to_same_document(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    let left =
        fs::canonicalize(left).unwrap_or_else(|_| normalize_path_lexically(left.to_path_buf()));
    let right =
        fs::canonicalize(right).unwrap_or_else(|_| normalize_path_lexically(right.to_path_buf()));
    left == right
}

pub(crate) fn percent_decode_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(value) = hex_pair(bytes[index + 1], bytes[index + 2]) {
                decoded.push(value);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8(decoded)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
}

pub(crate) fn hex_pair(high: u8, low: u8) -> Option<u8> {
    Some(hex_value(high)? << 4 | hex_value(low)?)
}

pub(crate) fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
