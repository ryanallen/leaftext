//! The `leaf-site://` scheme: the open HTML page's own folder, one requested file at a time.
//!
//! A contained page is drawn from the file the reader opened, and a page is rarely one file — its stylesheet, its pictures, its fonts and its media sit beside it. This is the only door to them, and it is a narrow one: it answers a path under the folder of the page that is open, it refuses everything that is not a page asset, and it never lists or walks a folder. The page cannot ask it what is there; it can only ask for something by name.
//!
//! **It is not [`crate::markdown::image_protocol`] widened.** That responder grants the page read access only where the type is a picture, and its tests admit pictures alone — serving CSS, fonts and media through it would widen a boundary by changing what a passing test means. This is its own scheme with its own list.
//!
//! **The folder is staged, not carried in the address.** A whole path in the URL would let the page ask for any folder on the disk by writing one; an id that only the render hands out means the page can name a file under the open document's folder and nowhere else.

use crate::*;
use std::sync::Mutex;

pub const SITE_PROTOCOL: &str = "leaf-site";
const SITE_HOST: &str = "local";

/// How many opened pages keep a folder answering. A tab switch and a live reload both re-render, so the address the frame is holding must still answer after several other documents have been opened; a page whose folder has aged out draws its own words and loses its decorations rather than failing.
const STAGED_SITE_FOLDERS: usize = 16;

static STAGED_FOLDERS: Mutex<Vec<(u64, PathBuf)>> = Mutex::new(Vec::new());

/// One answer from the responder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

/// What a page asset may be. Anything not on this list is refused, which is what keeps the scheme from being a way to read a document, a key or an archive out of the folder somebody opened a page from.
///
/// It is not a second copy of `format.rs`: that table is the formats Leaftext *opens*, and this is what a browser will *draw inside a page*. The two lists share nothing on purpose — a `.md` beside the page is a document, not a page asset, and is refused here.
const SITE_ASSET_TYPES: &[(&str, &str)] = &[
    ("css", "text/css; charset=utf-8"),
    ("woff2", "font/woff2"),
    ("woff", "font/woff"),
    ("ttf", "font/ttf"),
    ("otf", "font/otf"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("ogv", "video/ogg"),
    ("mp3", "audio/mpeg"),
    ("m4a", "audio/mp4"),
    ("oga", "audio/ogg"),
    ("wav", "audio/wav"),
    ("flac", "audio/flac"),
];

/// Stage a folder and return the address the prepared page uses as its base.
///
/// The id is the folder's own name hashed rather than a number handed out in turn, so the same folder is always the same address. That is what keeps a render reproducible: an address that changed every time would make the same file render to a different page each open, which the tab cache reads as a document that has changed and re-renders whole.
pub(crate) fn stage_site_folder(folder: &Path) -> String {
    let folder = normalize_path_lexically(folder);
    let id = folder_id(&folder);
    if let Ok(mut staged) = STAGED_FOLDERS.lock() {
        if let Some(at) = staged.iter().position(|(known, _)| *known == id) {
            // To the back, so the folder somebody is reading is the last one an older tab ages out.
            let known = staged.remove(at);
            staged.push(known);
        } else {
            staged.push((id, folder));
        }
        let over = staged.len().saturating_sub(STAGED_SITE_FOLDERS);
        staged.drain(..over);
    }
    site_webview_url(&format!("{id}/"))
}

/// The name a folder is staged under: FNV-1a over its own bytes.
///
/// Written here rather than taken from the standard library, whose default hasher is explicitly allowed to change between Rust releases. What that would change is the address inside every rendered HTML page, which the render pins in `src/tests/web_core.rs` measure — so a compiler upgrade would break a test about something it has nothing to do with. This answer is the same in every build, for ever.
fn folder_id(folder: &Path) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in folder.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// The whole answer for one request.
pub fn site_protocol_response(uri: &str) -> SiteResponse {
    let Some(path) = site_protocol_path(uri) else {
        return empty_site_response(404);
    };
    // A folder is not a file, and this responder has no other answer for one: there is no listing here, and never will be.
    if path.is_dir() {
        return empty_site_response(404);
    }
    let Some(content_type) = site_asset_type(&path) else {
        return empty_site_response(415);
    };
    match fs::read(&path) {
        Ok(body) => SiteResponse {
            status: 200,
            content_type,
            body,
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => empty_site_response(404),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => empty_site_response(403),
        Err(_) => empty_site_response(500),
    }
}

/// The file a request names, or nothing. Nothing where the address is not this scheme's, where the folder is not staged, where the path is empty, or where the path leaves the folder — which is asked after the path is put back together rather than by looking for `..` in it, because `%2e%2e` and a symbolic link both spell the same escape without those two characters in the address.
pub fn site_protocol_path(uri: &str) -> Option<PathBuf> {
    let url = Url::parse(uri).ok()?;
    if !is_site_request_url(&url) {
        return None;
    }
    let mut segments = url.path_segments()?.filter(|segment| !segment.is_empty());
    let id = segments.next()?.parse::<u64>().ok()?;
    let folder = staged_folder(id)?;

    let mut wanted = folder.clone();
    for segment in segments {
        let decoded = percent_decode_path(segment);
        if decoded.is_empty() || decoded == "." || decoded == ".." {
            return None;
        }
        wanted.push(decoded);
    }
    if wanted == folder {
        return None;
    }

    // The path as the disk resolves it, so a link pointing out of the folder is refused by where it lands rather than by how it was spelled. A file that is not there cannot be canonicalized, and the lexical answer is what the read then refuses.
    let settled = fs::canonicalize(&wanted).unwrap_or_else(|_| normalize_path_lexically(&wanted));
    let root = fs::canonicalize(&folder).unwrap_or(folder);
    settled.starts_with(&root).then_some(settled)
}

fn staged_folder(id: u64) -> Option<PathBuf> {
    STAGED_FOLDERS
        .lock()
        .ok()?
        .iter()
        .find(|(staged, _)| *staged == id)
        .map(|(_, folder)| folder.clone())
}

/// What a page may draw, by ending. Pictures come off the reading view's own table so there is one answer to what a picture is; everything else is the list above.
fn site_asset_type(path: &Path) -> Option<&'static str> {
    let picture = local_image_mime_type(path);
    if picture.starts_with("image/") {
        return Some(picture);
    }
    let ending = path.extension()?.to_str()?.to_ascii_lowercase();
    SITE_ASSET_TYPES
        .iter()
        .find(|(candidate, _)| *candidate == ending)
        .map(|(_, mime)| *mime)
}

fn empty_site_response(status: u16) -> SiteResponse {
    SiteResponse {
        status,
        content_type: "text/plain; charset=utf-8",
        body: Vec::new(),
    }
}

pub(crate) fn is_site_request_url(url: &Url) -> bool {
    if url.scheme() == SITE_PROTOCOL {
        return url.host_str() == Some(SITE_HOST);
    }
    matches!(url.scheme(), "http" | "https")
        && url
            .host_str()
            .and_then(|host| host.strip_prefix(&format!("{SITE_PROTOCOL}.")))
            == Some(SITE_HOST)
}

/// The address as the web view spells it. Windows serves a custom scheme over `http://<scheme>.<host>`, the same translation `leaf-image` makes.
pub(crate) fn site_webview_url(path: &str) -> String {
    let url = format!("{SITE_PROTOCOL}://{SITE_HOST}/{path}");
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        url.replacen(
            &format!("{SITE_PROTOCOL}://"),
            &format!("http://{SITE_PROTOCOL}."),
            1,
        )
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        url
    }
}

/// Both spellings of the scheme, for a Content-Security-Policy that has to name it. The app page's own policy names `leaf-image` the same way and for the same reason: which of the two a request arrives as is the platform's answer, not ours.
pub(crate) const SITE_POLICY_SOURCES: &str = "http://leaf-site.local leaf-site:";
