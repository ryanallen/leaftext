//! The renderer as a module a browser can load.
//!
//! It is the desktop's own render path compiled for `wasm32` — same parser, same sanitizer, same block maps — so a document embedded in somebody else's page is the document Leaftext draws. Nothing here renders anything itself; it hands bytes across the boundary and calls the core.
//!
//! **Strings cross as length-prefixed bytes**, because a module and its page share only memory and numbers. The page calls [`leaf_alloc`], writes UTF-8 into what comes back, calls [`leaf_render`], reads a `u32` length off the front of the answer, then frees both. No binding generator, which keeps this package to one dependency the app did not already ship.
//!
//! **What a browser can answer, it answers.** A page has no vault types, no repository and no image files to measure, so a document arrives without those three decorations rather than failing. A glossary it can have: the host walks the folder and hands the text over with [`leaf_set_glossary`], and the render auto-links its terms exactly as the desktop does.

use leaftext::{opened_document_from_source_with_host, GlossaryTerm, LeafHost};
use std::path::Path;
use std::sync::Mutex;

/// The glossary the page handed over, if it has one. A browser has no folder to walk for the nearest `GLOSSARY.md`, so the host that does the walking hands the text across instead — and the render auto-links its terms exactly as it does on the desktop.
static GLOSSARY: Mutex<Vec<GlossaryTerm>> = Mutex::new(Vec::new());

/// The glossary's own text, kept so the sheet a `glossary:` link raises can be rendered from it.
static GLOSSARY_SOURCE: Mutex<String> = Mutex::new(String::new());

/// A host with the one read a page can actually answer.
struct PageHost;

impl LeafHost for PageHost {
    fn glossary_terms(&self, _document_dir: &Path) -> Vec<GlossaryTerm> {
        GLOSSARY.lock().map(|held| held.clone()).unwrap_or_default()
    }

    /// This host does know a document's neighbors — the page holds the list — so it draws the waiting state and fills it, the same bargain the desktop makes.
    fn pager_placeholder(&self) -> Option<&'static str> {
        leaftext::pager_loading_html()
    }
}

/// Hand over a glossary's text — the same `## Term` headings the desktop reads off the nearest `GLOSSARY.md`. Empty text takes it away.
///
/// # Safety
/// `ptr` must address `len` initialized bytes.
#[no_mangle]
pub unsafe extern "C" fn leaf_set_glossary(ptr: *const u8, len: usize) {
    let terms = borrow_str(ptr, len)
        .map(leaftext::glossary_terms_in)
        .unwrap_or_default();
    if let Ok(mut held) = GLOSSARY.lock() {
        *held = terms;
    }
    if let Ok(mut held) = GLOSSARY_SOURCE.lock() {
        *held = borrow_str(ptr, len).unwrap_or_default().to_string();
    }
}

/// Memory for the page to write a string into. It owns what comes back until it hands the same pointer and length to [`leaf_free`].
///
/// # Safety
/// The returned pointer is valid for `len` bytes and must be freed with the same `len`.
#[no_mangle]
pub extern "C" fn leaf_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Hand back memory that came from [`leaf_alloc`] or [`leaf_render`].
///
/// # Safety
/// `ptr` must have come from this module with exactly this `len`, and must not be used again.
#[no_mangle]
pub unsafe extern "C" fn leaf_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Vec::from_raw_parts(ptr, len, len));
}

/// Render `source` as the document at `path`, and answer with the same shape the desktop sends its own page: the title, the HTML, the outline, the block ranges and the task offsets, as JSON.
///
/// The answer is its own byte length as a little-endian `u32` followed by that many bytes of UTF-8. The page frees it with [`leaf_free`] over `4 + length`. A null pointer back means the source was not UTF-8 — the only way this can fail.
///
/// # Safety
/// Both pointers must address that many initialized bytes, and both stay the page's to free.
#[no_mangle]
pub unsafe extern "C" fn leaf_render(
    source_ptr: *const u8,
    source_len: usize,
    path_ptr: *const u8,
    path_len: usize,
) -> *mut u8 {
    let Some(source) = borrow_str(source_ptr, source_len) else {
        return std::ptr::null_mut();
    };
    // A path with nothing readable in it still names the document; the render only ever reads its name and its folder.
    let path = borrow_str(path_ptr, path_len).unwrap_or("document.md");

    let document = opened_document_from_source_with_host(source, Path::new(path), &PageHost);
    let json = serde_json::to_string(&document).unwrap_or_else(|_| String::from("{}"));
    into_length_prefixed(json.into_bytes())
}

/// Leaftext's own stylesheet — the themes, the tokens, the icons and the document rules, in the order they have to resolve in. The embedding page owns the frame; this is what makes what sits inside it a Leaftext document rather than someone's approximation of one.
///
/// A theme is chosen by stamping `data-leaf-theme` and `data-leaf-appearance` on the root element, which is what the desktop's own page does.
///
/// Answers length-prefixed, freed like the rest.
#[no_mangle]
pub extern "C" fn leaf_styles() -> *mut u8 {
    into_length_prefixed(leaftext::reading_mode_css().as_bytes().to_vec())
}

// The app in a browser: its own page and front end, for a host that means to be Leaftext rather than to embed a document in something else.

/// Where a browser serves the app's own assets from. The desktop answers this with its own protocol; a page answers with a path.
#[cfg(feature = "shell")]
struct WebHost;

#[cfg(feature = "shell")]
impl LeafHost for WebHost {
    // Relative, not rooted: a static site is often published under a folder rather than at the top of a domain, and the page's own address is the only thing that knows which.
    fn asset_url(&self, name: &str) -> Option<String> {
        Some(format!("assets/{name}"))
    }
}

/// The app's own page, with its asset URLs pointed at a browser. Everything the reader is drawn with — the bar, the pane, the toolbar, the minimap — is markup this returns, not markup an embedding page writes.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_page() -> *mut u8 {
    into_length_prefixed(leaftext::app_shell_html_for_host(&WebHost).into_bytes())
}

/// The app's own front end, the same ordered fragments the desktop serves as `app.js`.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_script() -> *mut u8 {
    into_length_prefixed(leaftext::app_shell_script().as_bytes().to_vec())
}

/// What the page reads on boot before anything is open: the reader's settings, the version, the formats it may open. The host is what fills these in, so a browser sends the same lines the desktop injects.
#[cfg(feature = "shell")]
#[no_mangle]
pub extern "C" fn leaf_boot_script() -> *mut u8 {
    let settings = leaftext::Settings::default();
    let boot = format!(
        "{}\n{}\n{}\n{}\n{}",
        leaftext::initial_settings_script(&settings),
        // No recents and no favorites: a page has neither, and an empty pair is what the start screen already draws from.
        leaftext::initial_state_script(&[], &leaftext::Favorites::default()),
        leaftext::initial_document_exts_script(),
        leaftext::initial_version_script(),
        leaftext::initial_update_script(),
    );
    into_length_prefixed(boot.into_bytes())
}

/// A rendered document as the line the page already knows how to take: the same call the desktop makes when a file opens.
///
/// # Safety
/// Both pointers must address that many initialized bytes.
#[cfg(feature = "shell")]
#[no_mangle]
pub unsafe extern "C" fn leaf_document_script(
    source_ptr: *const u8,
    source_len: usize,
    path_ptr: *const u8,
    path_len: usize,
) -> *mut u8 {
    let Some(source) = borrow_str(source_ptr, source_len) else {
        return std::ptr::null_mut();
    };
    let path = borrow_str(path_ptr, path_len).unwrap_or("document.md");
    let document = opened_document_from_source_with_host(source, Path::new(path), &PageHost);
    // The whole workspace, not just the document: the tab strip and the floating toolbar are drawn off the tabs, so a document sent without them arrives in a window with no chrome around it.
    // Title first, then path — the order the page reads a tab in.
    let tabs = vec![(
        leaftext::tab_title_from_path(Path::new(path)),
        path.to_string(),
    )];
    into_length_prefixed(
        leaftext::workspace_state_script(
            &[],
            &leaftext::Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
        )
        .into_bytes(),
    )
}

/// The glossary itself, rendered, for the sheet a `glossary:` link raises. The page asks the host for it; on the desktop the host reads the file, and here it renders the text it was handed.
///
/// `href` is the link that was followed — `glossary:some-term` — because the sheet scrolls to that term rather than to the top of the file. Without it the sheet opens on a glossary and says it has no entry for nothing.
///
/// # Safety
/// `ptr` must address `len` initialized bytes.
#[cfg(feature = "shell")]
#[no_mangle]
pub unsafe extern "C" fn leaf_glossary_script(ptr: *const u8, len: usize) -> *mut u8 {
    let Ok(source) = GLOSSARY_SOURCE.lock() else {
        return into_length_prefixed(leaftext::glossary_failed_script("failed").into_bytes());
    };
    if source.is_empty() {
        return into_length_prefixed(leaftext::glossary_failed_script("missing").into_bytes());
    }
    let anchor = borrow_str(ptr, len)
        .and_then(|href| href.split_once(':').map(|(_, rest)| rest))
        .map(|rest| rest.trim_start_matches('#'))
        .unwrap_or_default();
    let rendered =
        leaftext::render_markdown_document_with_host(&source, Path::new("GLOSSARY.md"), &PageHost);
    into_length_prefixed(leaftext::glossary_sheet_script(&rendered.html, anchor).into_bytes())
}

/// What the module can read, so a page can tell a stale module from a current one without loading a second copy of the app.
#[no_mangle]
pub extern "C" fn leaf_formats() -> *mut u8 {
    let extensions = leaftext::all_document_extensions().join(" ");
    into_length_prefixed(extensions.into_bytes())
}

/// # Safety
/// `ptr` must address `len` initialized bytes.
unsafe fn borrow_str<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).ok()
}

/// The little-endian `u32` length, then the bytes, in one allocation the page frees whole.
fn into_length_prefixed(bytes: Vec<u8>) -> *mut u8 {
    let mut answer = Vec::with_capacity(4 + bytes.len());
    answer.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    answer.extend_from_slice(&bytes);
    let ptr = answer.as_mut_ptr();
    std::mem::forget(answer);
    ptr
}
