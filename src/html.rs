//! The reading view of a whole HTML file: the page its own CSS draws, inside a frame of its own.
//!
//! An HTML file has one reading view and it is the page. There is nothing to press and nothing to turn off — the source view stays where the file is edited, and this is what a reader sees.
//!
//! **The page is inlined, not served.** The app shell is loaded with `with_html`, so its address is `about:blank` and its origin is opaque; nothing served from any address is same-origin with it, and a frame pointing at one answers `contentDocument` as null. That would leave Find, the outline, the minimap and the selection dead on every HTML file. So the prepared page rides in the frame's `srcdoc`, which keeps it on the shell's own origin and reachable.
//!
//! **What contains it is the sandbox and the page's own policy.** `sandbox="allow-same-origin"` is the only grant: without `allow-scripts` the page runs nothing, which was watched — the same page set a value on the parent unsandboxed and set nothing under this. On top of that the page carries a `<meta>` policy of its own. A `srcdoc` document inherits the app page's policy and enforces its own as well, so the two are additive and a contained page can only ever be tighter than the app page, never looser: `default-src 'none'` here refuses network addresses the app page itself allows.
//!
//! [`crate::markdown::configure_site_html_sanitizer`] is the security boundary the source crosses on the way in; this module is what the cleaned page is wrapped in.

use crate::*;
use html_escape::encode_double_quoted_attribute;

/// What the contained page may reach. Written into the prepared page's own head, and additive with the app page's policy rather than instead of it.
///
/// Phase 1 of [the plan](../../../docs/done/storage/html-site-styles.md) allows exactly what a page carries inside itself: its own CSS, and pictures and fonts written into the file as `data:`. Every `http` and `https` address is refused, so a saved page cannot phone anywhere it was saved from. `base-uri` is deliberately absent: the author's `<base>` is dropped by the sanitizer and the one below is ours, so a directive here would only break our own. Where the folder is not this machine's — a browser — the page reaches what it carries inside itself and the origin the document was fetched from, which is where its own neighbors are. On the desktop the shell's origin is opaque, so `'self'` there names nothing and the policy is the tighter of the two by itself.
const SITE_PAGE_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline' 'self'; img-src data: 'self'; font-src data: 'self'; media-src 'self'; script-src 'none'; form-action 'none'; frame-src 'none'";

/// The same policy with the one scheme the page's own folder is served over. Every `http` and `https` address stays refused: what a saved page may reach is the folder it was saved into, and nothing on the network.
fn site_page_policy_with_folder() -> String {
    format!("default-src 'none'; style-src 'unsafe-inline' {SITE_POLICY_SOURCES}; img-src data: {SITE_POLICY_SOURCES}; font-src data: {SITE_POLICY_SOURCES}; media-src {SITE_POLICY_SOURCES}; script-src 'none'; form-action 'none'; frame-src 'none'")
}

/// How far into a file the page's own `<title>` is looked for. It sits in the head, so a whole-file scan on a large page would be a read that answers in the first few hundred bytes or not at all — this is the ceiling that claim is checked against before it slices.
const TITLE_SCAN_BYTES: usize = 64 * 1024;

/// Render a complete HTML page into an `OpenedDocument`, told who answers for it. Not a tree render: the page is not folded into Leaftext's own document body, it is drawn whole in a frame, so the shell around it is this module's rather than [`opened_document_from_tree`]'s.
pub(crate) fn opened_document_from_html_with_host(
    source: &str,
    path: &Path,
    host: &dyn LeafHost,
) -> OpenedDocument {
    let render_path = host.resolve_path(path);

    // A `srcdoc` document's own base is the shell's `about:blank`, where a relative address resolves to nothing. So the page carries a base of ours: the file's own folder, which is what a clicked relative link is resolved against. Nothing loads from it — the policy above refuses `file:` along with everything else — until the folder is served.
    //
    // Only where the host is the one serving that folder. A browser has no disk and must never be handed a `file:` address, which is the whole of why this is asked rather than worked out from the path: a page there resolves its links against wherever the document itself was fetched from. Two hosts, two answers. The desktop serves the folder itself and hands the page an address under its own scheme; a browser has no disk, so a published site resolves the page's neighbors under the folder it serves documents from and an embed resolves them against the page the document was fetched into, which the front end fills in because only it knows that address.
    let served = host
        .serves_local_images()
        .then(|| render_path.parent().map(stage_site_folder))
        .flatten();
    let base = match &served {
        Some(_) => served.clone(),
        None => host.served_documents_url().map(|root| {
            let folder = served_image_url(&root, &render_path, "./");
            format!("{}/", folder.trim_end_matches('/'))
        }),
    };
    let local_folder = served.is_some();

    let body = sanitize_site_html(source);
    let page = prepared_site_page(&body, base.as_deref(), local_folder);

    // The tab is named by the page's own `<title>`, and by the file's name where it has none. No borrowed `<h1>` is prepended any more: a heading Leaftext wrote above somebody's own hero is not that page.
    let title = site_page_title(source)
        .or_else(|| {
            render_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(plain_document_title)
                .map(|stem| xml_fallback_title(&stem))
        })
        .unwrap_or_else(|| "Untitled document".to_string());

    // Asked of the cleaned body rather than of the frame around it: the question is whether the page has anything on it, and a frame element answers that about itself rather than about what it holds.
    let has_visible_content = html_has_visible_content(&body);

    // No Previous/Next strip, and nothing else of Leaftext's, under the page. A whole HTML file is drawn as the page it is, so the frame is the only thing in the article and it fills the reader to the bottom edge; a strip below it would put a divider, a band of Leaftext's own spacing and two of Leaftext's own buttons inside somebody else's page.
    let html = format!(
        r#"<article class="document-body document-body-site"><iframe class="document-site" sandbox="allow-same-origin" title="{}" srcdoc="{}"></iframe></article>"#,
        encode_double_quoted_attribute(&title),
        encode_double_quoted_attribute(&page),
    );

    OpenedDocument {
        title,
        path: path.display().to_string(),
        html,
        has_visible_content,
        format: DocumentFormat::Html,
        blocks: Vec::new(),
        tasks: Vec::new(),
        source: source.to_string(),
        dialect: None,
    }
}

/// The frame is the page's viewport, so its scrollbar is the reader's scrollbar — and the reader already has one, which is the rail beside the page. `.reader-shell.has-minimap` hides the app's own bar for exactly this reason and the rail is not a choice any more, so the contained page hides its bar the same way rather than standing a second one over the first. Both spellings on purpose: `scrollbar-width` is what Chromium reads, and where it is not read at all the WebKit pseudo-element is.
const SITE_PAGE_CHROME: &str =
    "html{scrollbar-width:none}html::-webkit-scrollbar{width:0;height:0}";

/// The whole page as it goes into the frame: a head of ours around a body of theirs.
pub(crate) fn prepared_site_page(body: &str, base: Option<&str>, local_folder: bool) -> String {
    // The policy follows where the page's own neighbors are: this machine's folder over the one scheme that serves it, or the origin the document was fetched from.
    let policy = if local_folder {
        site_page_policy_with_folder()
    } else {
        SITE_PAGE_POLICY.to_string()
    };
    let base = base
        .map(|href| format!(r#"<base href="{}">"#, encode_double_quoted_attribute(href)))
        .unwrap_or_default();
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="{policy}">{base}<style>{SITE_PAGE_CHROME}</style></head><body>{body}</body></html>"#
    )
}

/// What the page calls itself. Read off the source rather than off the cleaned body, because the sanitizer takes `<title>` and its contents with it — drawn on the page, the head's title is a stray word above somebody's hero.
pub(crate) fn site_page_title(source: &str) -> Option<String> {
    let head = &source[..source.len().min(TITLE_SCAN_BYTES)];
    let lowered = head.to_ascii_lowercase();
    let open = lowered.find("<title")?;
    let after_name = open + "<title".len();
    // `<title>` or `<title lang="en">`, but never `<titlebar>`: the character after the name decides.
    let rest = lowered.get(after_name..)?;
    if !rest.starts_with(['>', ' ', '\t', '\r', '\n']) {
        return None;
    }
    let content_at = after_name + rest.find('>')? + 1;
    let close = lowered.get(content_at..)?.find("</title")?;
    plain_document_title(source.get(content_at..content_at + close)?)
}
