//! Percent-coding and lexical path cleanup.

use super::*;

/// A `file://` URL for a folder, which is what a rendered document's `base href` is. `None` where there are no file paths to make a URL out of — a browser has neither, and `url` does not compile the conversion for that target at all.
pub(crate) fn file_url_for_directory(directory: &Path) -> Option<Url> {
    #[cfg(any(unix, windows))]
    {
        Url::from_directory_path(directory).ok()
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = directory;
        None
    }
}

/// A `file://` URL for one file. `None` where there are none, as above.
pub(crate) fn file_url_for_path(path: &Path) -> Option<Url> {
    #[cfg(any(unix, windows))]
    {
        Url::from_file_path(path).ok()
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        None
    }
}

/// The path a `file://` URL points at, and `None` on a host with no file paths.
pub(crate) fn path_from_file_url(url: &Url) -> Option<PathBuf> {
    #[cfg(any(unix, windows))]
    {
        url.to_file_path().ok()
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = url;
        None
    }
}

pub(crate) fn percent_encode_url_path_segment(segment: &str) -> String {
    if segment == "." {
        return "%2E".to_string();
    }
    if segment == ".." {
        return "%2E%2E".to_string();
    }

    let mut encoded = String::with_capacity(segment.len());
    for byte in segment.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
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

pub(crate) fn normalize_path_lexically(path: &Path) -> PathBuf {
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
