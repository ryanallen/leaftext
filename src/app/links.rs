//! What a clicked href means, and where it points.

use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LinkTarget {
    AnchorOnly,
    External(String),
    /// A local file the app renders: followed in place, in the current tab.
    LocalDocument(String),
    /// A local file the app doesn't render: handed to the OS.
    LocalOther(String),
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
    } else {
        LinkTarget::LocalOther(href.to_string())
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

/// True when a local link points at a file the app renders, so it opens in the
/// reading view rather than being handed to the OS. Every format, not just
/// Markdown — otherwise a link to the `.json` beside a note leaves the app.
pub(crate) fn is_document_link(href: &str) -> bool {
    let path = local_path_from_href(href).unwrap_or_else(|| PathBuf::from(href));
    is_supported_document_path(&path)
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

pub(crate) fn paths_refer_to_same_document(left: &Path, right: &Path) -> bool {
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
