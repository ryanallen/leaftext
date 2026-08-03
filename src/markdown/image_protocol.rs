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
        Ok(body) => LocalImageResponse {
            status: 200,
            content_type: local_image_mime_type(&path),
            body,
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => empty_local_image_response(404),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            empty_local_image_response(403)
        }
        Err(_) => empty_local_image_response(500),
    }
}

pub(crate) fn local_image_protocol_path(uri: &str, source_dir: &Path) -> Option<PathBuf> {
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
        body: Vec::new(),
    }
}

/// True when `path` names a file the reading view displays as an image, so live reload refreshes the images in place instead of re-rendering.
pub fn is_local_image_path(path: &Path) -> bool {
    local_image_mime_type(path).starts_with("image/")
}

pub(crate) fn local_image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("apng") => "image/apng",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}
