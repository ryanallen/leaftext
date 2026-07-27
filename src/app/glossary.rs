//! The glossary bottom sheet.

use super::*;

/// For a `glossary:slug` href, return the slug (leading `#` stripped). It names
/// a term with no file path; the file is found separately by walking up folders.
pub(crate) fn glossary_scheme_slug(href: &str) -> Option<String> {
    let href = href.trim();
    let rest = href
        .get(..9)
        .and_then(|prefix| prefix.eq_ignore_ascii_case("glossary:").then(|| &href[9..]))?;
    Some(percent_decode_path(rest.trim_start_matches('#')))
}

/// Find the nearest `GLOSSARY.md` by walking up from `current_path`, so a
/// `glossary:` link binds to the open document's project. A lowercase
/// `glossary.md` is also accepted for case-sensitive trees.
pub(crate) fn nearest_glossary_file(current_path: &Path) -> Option<PathBuf> {
    let mut dir = current_path.parent();
    while let Some(folder) = dir {
        for name in ["GLOSSARY.md", "glossary.md"] {
            let candidate = folder.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        dir = folder.parent();
    }
    None
}

/// Tell the page a lookup failed. The sheet went up on a spinner when the link
/// was followed, so every path out of `show_glossary_entry` has to say something.
fn report_glossary_failure(webview: &WebView, reason: &str) {
    if let Err(error) = webview.evaluate_script(&glossary_failed_script(reason)) {
        eprintln!("Failed to report the glossary failure: {error}");
    }
}

/// Read the glossary file for `href` (nearest `GLOSSARY.md` for a `glossary:`
/// link, or a real `…/GLOSSARY.md#slug` path) and show the term in the bottom
/// sheet. Failures are logged, and told to the page so its spinner stops.
pub(crate) fn show_glossary_entry(webview: Option<&WebView>, href: &str, current_path: &Path) {
    let Some(webview) = webview else {
        return;
    };
    let (path, anchor) = if let Some(slug) = glossary_scheme_slug(href) {
        match nearest_glossary_file(current_path) {
            Some(path) => (path, slug),
            None => {
                eprintln!("No GLOSSARY.md found above {}", current_path.display());
                report_glossary_failure(webview, "missing");
                return;
            }
        }
    } else {
        (
            path_from_local_link(href, current_path),
            fragment_from_href(href).unwrap_or_default(),
        )
    };
    // Glossary terms are browsed from the same (often large) file, so reuse the
    // last render when the file is unchanged; the mtime check reloads after edits.
    let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok();
    let cached = GLOSSARY_RENDER_CACHE.with(|cache| {
        cache
            .borrow()
            .as_ref()
            .filter(|entry| entry.path == path && entry.modified == modified)
            .map(|entry| entry.html.clone())
    });
    let html = match cached {
        Some(html) => html,
        None => {
            let markdown = match fs::read_to_string(&path) {
                Ok(markdown) => markdown,
                Err(error) => {
                    eprintln!("Failed to read glossary {}: {error}", path.display());
                    // A path the user linked to that isn't there reads the same
                    // as no glossary at all, which is the more useful message.
                    let reason = if path.exists() { "failed" } else { "missing" };
                    report_glossary_failure(webview, reason);
                    return;
                }
            };
            let html = render_markdown_document(&markdown, &path).html;
            GLOSSARY_RENDER_CACHE.with(|cache| {
                *cache.borrow_mut() = Some(GlossaryRender {
                    path: path.clone(),
                    modified,
                    html: html.clone(),
                });
            });
            html
        }
    };
    if let Err(error) = webview.evaluate_script(&glossary_sheet_script(&html, &anchor)) {
        eprintln!("Failed to show glossary entry: {error}");
    }
}

// The last rendered glossary, reused across lookups of the same unchanged file.
// Keyed by path + mtime; a newer mtime forces a fresh render.
pub(crate) struct GlossaryRender {
    pub(crate) path: PathBuf,
    pub(crate) modified: Option<std::time::SystemTime>,
    pub(crate) html: String,
}

thread_local! {
    static GLOSSARY_RENDER_CACHE: std::cell::RefCell<Option<GlossaryRender>> =
        std::cell::RefCell::new(None);
}
