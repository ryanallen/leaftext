//! The bounded, cached render behind a local link hover preview.

use super::*;

const LINK_PREVIEW_HEAD_BYTES: usize = 64 * 1024;

/// Render the opening of the readable local document `href` names from `current_path`.
pub(crate) fn link_preview_html(href: &str, current_path: &Path) -> Option<String> {
    let path = linked_document_path(href, current_path)?;
    let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok()?;
    let cached = LINK_PREVIEW_CACHE.with(|cache| {
        cache
            .borrow()
            .get(&path)
            .filter(|entry| entry.modified == modified)
            .map(|entry| entry.html.clone())
    });
    cached.or_else(|| {
        let source = read_source_head(&path, LINK_PREVIEW_HEAD_BYTES).ok()?;
        let html = render_markdown_document(&source.text, &path).html;
        LINK_PREVIEW_CACHE.with(|cache| {
            cache.borrow_mut().insert(
                path,
                LinkPreviewRender {
                    modified,
                    html: html.clone(),
                },
            );
        });
        Some(html)
    })
}

struct LinkPreviewRender {
    modified: std::time::SystemTime,
    html: String,
}

thread_local! {
    static LINK_PREVIEW_CACHE: std::cell::RefCell<HashMap<PathBuf, LinkPreviewRender>> =
        std::cell::RefCell::new(HashMap::new());
}
