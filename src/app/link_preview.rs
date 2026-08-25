//! The bounded, cached render behind a local link hover preview.

use super::*;

// Every Markdown document in reach, so the page can lift the section an address names out of what arrived: 2.3 times the largest file here, and a file past it previews its opening rather than nothing. The 79ms it costs falls inside the rest the card already waits out, so nobody meets it.
const LINK_PREVIEW_HEAD_BYTES: usize = 256 * 1024;

// A tree format is parsed whole or not at all — a cut JSON, XML or YAML file answers a parse error, so an opening is not a smaller document the way Markdown's is. A megabyte holds the worst rest to about a fifth of a second of rendering, and a file past it gets no picture rather than a complaint about a file that opens perfectly in a tab.
const LINK_PREVIEW_WHOLE_FILE_BYTES: u64 = 1024 * 1024;

// An entry is a render of up to 313 KB, so the oldest goes rather than every file rested on being held for the life of the session.
pub(super) const LINK_PREVIEW_CACHE_ENTRIES: usize = 16;

/// Render the readable local document `href` names from `current_path`, through the renderer its own format picks, for the page to lift the section the address names out of.
pub(crate) fn link_preview_html(href: &str, current_path: &Path) -> Option<String> {
    let path = hover_card_document_path(href, current_path)?;
    let meta = fs::metadata(&path).ok()?;
    let modified = meta.modified().ok()?;
    let cached = LINK_PREVIEW_CACHE.with(|cache| {
        cache
            .borrow()
            .renders
            .get(&path)
            .filter(|entry| entry.modified == modified)
            .map(|entry| entry.html.clone())
    });
    cached.or_else(|| {
        let source = read_for_preview(&path, meta.len())?;
        // The card walks no folder, so it is drawn by a host that promises no Previous/Next strip.
        let host = DesktopHost {
            no_pager_placeholder: true,
            ..DesktopHost::default()
        };
        let html = opened_document_from_source_with_host(&source.text, &path, &host).html;
        LINK_PREVIEW_CACHE.with(|cache| {
            cache.borrow_mut().keep(
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

/// How much of a file its own renderer needs. Exhaustive on `DocumentFormat` on purpose: a sixth format answers for itself here rather than silently inheriting Markdown's opening.
fn read_for_preview(path: &Path, size: u64) -> Option<SourceText> {
    match DocumentFormat::from_path(path) {
        // Prose reads back as prose wherever it is cut, so the opening is a smaller document.
        DocumentFormat::Markdown => read_source_head(path, LINK_PREVIEW_HEAD_BYTES).ok(),
        DocumentFormat::Xml | DocumentFormat::Json | DocumentFormat::Yaml | DocumentFormat::Eml => {
            (size <= LINK_PREVIEW_WHOLE_FILE_BYTES)
                .then(|| read_source(path).ok())
                .flatten()
        }
    }
}

pub(super) struct LinkPreviewRender {
    pub(super) modified: std::time::SystemTime,
    pub(super) html: String,
}

#[derive(Default)]
pub(super) struct LinkPreviewCache {
    pub(super) renders: HashMap<PathBuf, LinkPreviewRender>,
    // The paths in the order they were first rendered, so the one held longest is the one dropped.
    pub(super) order: Vec<PathBuf>,
}

impl LinkPreviewCache {
    pub(super) fn keep(&mut self, path: PathBuf, render: LinkPreviewRender) {
        // A re-render of a file already held keeps its place: what is being replaced is a stale copy of the same document, not a new one.
        if self.renders.insert(path.clone(), render).is_none() {
            self.order.push(path);
        }
        while self.order.len() > LINK_PREVIEW_CACHE_ENTRIES {
            let oldest = self.order.remove(0);
            self.renders.remove(&oldest);
        }
    }
}

thread_local! {
    static LINK_PREVIEW_CACHE: std::cell::RefCell<LinkPreviewCache> =
        std::cell::RefCell::new(LinkPreviewCache::default());
}
