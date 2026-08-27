//! The `leaf-image://` scheme: building its URLs, serving its requests.

use super::*;

pub fn local_image_source_dir(source_path: &Path) -> Option<PathBuf> {
    source_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(normalize_path_lexically)
}

pub(crate) fn local_image_protocol_url_for_relative_destination(
    destination: &str,
    source_dir: &Path,
) -> Option<String> {
    let path = local_image_destination_path(destination)?;
    if path.is_absolute() {
        return local_image_protocol_url_for_path(&path, source_dir);
    }

    local_image_protocol_url_for_relative_path(&path, source_dir)
}

pub(crate) fn local_image_destination_path(destination: &str) -> Option<PathBuf> {
    let path = destination.split(['#', '?']).next().unwrap_or(destination);
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(percent_decode_path(path)))
}

pub(crate) fn local_image_protocol_url_for_path(path: &Path, source_dir: &Path) -> Option<String> {
    let normalized_path = normalize_path_lexically(path);
    let normalized_source_dir = normalize_path_lexically(source_dir);

    match normalized_path.strip_prefix(&normalized_source_dir) {
        Ok(relative) => {
            local_image_protocol_url_for_relative_path(relative, &normalized_source_dir)
        }
        // Anywhere else on disk: carry the whole path in the URL.
        Err(_) => local_image_protocol_url_for_absolute_path(&normalized_path),
    }
}

pub(crate) fn local_image_protocol_url_for_absolute_path(path: &Path) -> Option<String> {
    let path = path.to_str()?;
    if path.is_empty() {
        return None;
    }

    Some(local_image_webview_url(&format!(
        "{LOCAL_IMAGE_ABSOLUTE_SEGMENT}/{}",
        percent_encode_url_path_segment(path)
    )))
}

pub(crate) fn local_image_relative_url_for_path(path: &Path, source_dir: &Path) -> Option<String> {
    let normalized_path = normalize_path_lexically(path);
    let normalized_source_dir = normalize_path_lexically(source_dir);
    let relative = normalized_path.strip_prefix(&normalized_source_dir).ok()?;

    local_image_relative_url(relative)
}

pub(crate) fn local_image_protocol_url_for_relative_path(
    relative_path: &Path,
    _source_dir: &Path,
) -> Option<String> {
    let mut segments = Vec::new();

    for component in relative_path.components() {
        match component {
            std::path::Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.is_empty() {
                    return None;
                }
                segments.push(percent_encode_url_path_segment(&segment));
            }
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                segments.push(LOCAL_IMAGE_PARENT_SEGMENT.to_string())
            }
            _ => return None,
        }
    }

    (!segments.is_empty()).then(|| local_image_webview_url(&segments.join("/")))
}

pub(crate) fn local_image_relative_url(relative_path: &Path) -> Option<String> {
    let relative_path = normalize_path_lexically(relative_path);
    let mut segments = Vec::new();

    for component in relative_path.components() {
        match component {
            std::path::Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.is_empty() {
                    return None;
                }
                segments.push(percent_encode_url_path_segment(&segment));
            }
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }

    (!segments.is_empty()).then(|| segments.join("/"))
}

pub fn local_image_protocol_response(uri: &str, source_dir: Option<&Path>) -> LocalImageResponse {
    let Some(source_dir) = source_dir else {
        return empty_local_image_response(404);
    };
    let Some(path) = local_image_protocol_path(uri, source_dir) else {
        return empty_local_image_response(404);
    };

    match fs::read(&path) {
        Ok(body) => {
            let content_type = local_image_mime_type(&path);
            LocalImageResponse {
                status: 200,
                content_type,
                // Only a picture the reading view draws may be read back by the page. This responder hands back whatever file the address names, so an unconditional `*` would let a script that got into the page read the bytes of any file on the disk; the type is what holds it to pictures, which the page can already cause to be drawn.
                allow_origin: allow_origin_for(content_type),
                body,
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => empty_local_image_response(404),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            empty_local_image_response(403)
        }
        Err(_) => empty_local_image_response(500),
    }
}

pub fn local_image_protocol_path(uri: &str, source_dir: &Path) -> Option<PathBuf> {
    let url = Url::parse(uri).ok()?;
    if !is_local_image_request_url(&url) {
        return None;
    }

    let mut segments = url.path_segments()?.filter(|segment| !segment.is_empty());

    // `__leaf_absolute__/<encoded path>`: the path stands on its own.
    let mut relative = PathBuf::new();
    for segment in segments.by_ref() {
        let decoded = percent_decode_path(segment);
        if decoded == LOCAL_IMAGE_ABSOLUTE_SEGMENT && relative.as_os_str().is_empty() {
            let absolute = PathBuf::from(percent_decode_path(segments.next()?));
            return (!absolute.as_os_str().is_empty()).then(|| normalize_path_lexically(&absolute));
        }
        if decoded == LOCAL_IMAGE_PARENT_SEGMENT {
            relative.push("..");
            continue;
        }
        if decoded.is_empty() || decoded == "." || decoded == ".." {
            return None;
        }
        relative.push(decoded);
    }
    if relative.as_os_str().is_empty() {
        return None;
    }

    Some(normalize_path_lexically(&source_dir.join(relative)))
}

pub(crate) fn is_local_image_request_url(url: &Url) -> bool {
    if url.scheme() == LOCAL_IMAGE_PROTOCOL {
        return url.host_str() == Some(LOCAL_IMAGE_HOST);
    }

    matches!(url.scheme(), "http" | "https")
        && url
            .host_str()
            .and_then(|host| host.strip_prefix(&format!("{LOCAL_IMAGE_PROTOCOL}.")))
            == Some(LOCAL_IMAGE_HOST)
}

pub(crate) fn local_image_webview_url(path: &str) -> String {
    let protocol_url = format!("{LOCAL_IMAGE_PROTOCOL}://{LOCAL_IMAGE_HOST}/{path}");
    local_image_webview_url_from_protocol_url(&protocol_url)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) fn local_image_webview_url_from_protocol_url(url: &str) -> String {
    url.replacen(
        &format!("{LOCAL_IMAGE_PROTOCOL}://"),
        &format!("http://{LOCAL_IMAGE_PROTOCOL}."),
        1,
    )
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub(crate) fn local_image_webview_url_from_protocol_url(url: &str) -> String {
    url.to_string()
}

pub(crate) fn empty_local_image_response(status: u16) -> LocalImageResponse {
    LocalImageResponse {
        status,
        content_type: "text/plain; charset=utf-8",
        allow_origin: "",
        body: Vec::new(),
    }
}

/// Who may read one of these answers back. A picture the reading view draws is readable by the page, which is what lets a reader export one in a format the file is not already in; nothing else is, because nothing else is a picture.
fn allow_origin_for(content_type: &str) -> &'static str {
    if content_type.starts_with("image/") {
        "*"
    } else {
        ""
    }
}

/// True when `path` names a file the reading view displays as an image, so live reload refreshes the images in place instead of re-rendering.
pub fn is_local_image_path(path: &Path) -> bool {
    local_image_mime_type(path).starts_with("image/")
}

/// Every picture the reading view can draw: the ending, and the type the web view is handed with the bytes. The Insert image window reads the same table, which is why an ending lives here and nowhere else.
pub(crate) const DRAWABLE_IMAGE_TYPES: &[(&str, &str)] = &[
    ("apng", "image/apng"),
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("gif", "image/gif"),
    ("ico", "image/x-icon"),
    ("jfif", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("jpg", "image/jpeg"),
    ("png", "image/png"),
    ("svg", "image/svg+xml"),
    ("webp", "image/webp"),
];

/// The endings the Insert image window offers, off the same table — so it can neither offer a picture the reading view will not draw nor hide one it would.
pub fn drawable_image_extensions() -> Vec<&'static str> {
    DRAWABLE_IMAGE_TYPES
        .iter()
        .map(|(ending, _)| *ending)
        .collect()
}

pub(crate) fn local_image_mime_type(path: &Path) -> &'static str {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .and_then(|ending| {
            DRAWABLE_IMAGE_TYPES
                .iter()
                .find(|(candidate, _)| *candidate == ending)
        })
        .map_or("application/octet-stream", |(_, mime)| *mime)
}
