use super::*;

const COMPLETE_PAGE: &str = r#"<!doctype html>
<html><head><title>Ignored title</title><style>body { color: red }</style><script>alert(1)</script></head>
<body onload="alert(2)"><main><section><h2>Kept heading</h2><p onclick="alert(3)">Safe words <a href="javascript:alert(4)">bad link</a></p><form><button>Do nothing</button></form></section></main></body></html>"#;

/// The whole page as it goes into the frame, read back out of the `srcdoc` attribute the article carries it in.
fn site_page_of(html: &str) -> String {
    let at = html.find("srcdoc=\"").expect("the frame carries the page");
    let rest = &html[at + "srcdoc=\"".len()..];
    let end = rest.find('"').expect("the attribute closes");
    html_escape::decode_html_entities(&rest[..end]).to_string()
}

#[test]
fn html_extensions_open_as_html() {
    for extension in ["html", "htm"] {
        let path = PathBuf::from(format!("saved-report.{extension}"));
        assert_eq!(DocumentFormat::for_path(&path), Some(DocumentFormat::Html));
        assert_eq!(DocumentFormat::from_path(&path), DocumentFormat::Html);
    }
    assert_eq!(DocumentFormat::Html.display_name(), "HTML");
    assert_eq!(DocumentFormat::Html.language_token(), "html");
}

#[test]
fn complete_html_page_is_drawn_as_its_own_page() {
    let document = opened_document_from_source(COMPLETE_PAGE, "saved-report.html");

    // The page names itself, so the tab takes that name rather than the file's, and no borrowed heading is written above somebody else's page.
    assert_eq!(document.title, "Ignored title");
    assert_eq!(document.format, DocumentFormat::Html);
    assert!(!document.html.contains("data-borrowed-title"));
    assert_contains(
        &document.html,
        r#"<iframe class="document-site" sandbox="allow-same-origin""#,
    );
    // One grant and no other. `allow-same-origin` is what keeps the frame reachable so Find and the outline still work; every one of these would give the page back something the sandbox is there to take away.
    for grant in [
        "allow-scripts",
        "allow-forms",
        "allow-popups",
        "allow-downloads",
        "allow-top-navigation",
        "allow-modals",
        "allow-pointer-lock",
        "allow-presentation",
    ] {
        assert!(
            !document.html.contains(grant),
            "the frame was given {grant} as well"
        );
    }
    // Whatever the page holds rides in an attribute, so no tag out of the document reaches the app page's own markup.
    assert!(!document.html.contains("<main>"));
    assert!(!document.html.contains("<style>"));

    let page = site_page_of(&document.html);
    assert_contains(&page, "<style>body { color: red }</style>");
    assert_contains(&page, "<main><section><h2>Kept heading</h2>");
    assert_contains(
        &page,
        "Safe words <a rel=\"noopener noreferrer\">bad link</a>",
    );
    for removed in [
        "alert(1)",
        "onload",
        "onclick",
        "javascript:",
        "<form",
        "<button",
        "<title",
    ] {
        assert!(!page.contains(removed), "the page kept {removed}: {page}");
    }
    assert!(document.blocks.is_empty());
    assert!(document.tasks.is_empty());
    assert!(EditableDocument::new(
        PathBuf::from("saved-report.html"),
        SourceText::utf8(COMPLETE_PAGE.to_string())
    )
    .block_source_map()
    .is_empty());
}

/// The page is the whole of the reader: nothing of Leaftext's is drawn beside it, and its own scrollbar is off because the rail beside the page is the reader's scrollbar.
#[test]
fn nothing_of_leaftexts_is_drawn_around_the_page() {
    let document = opened_document_from_source(COMPLETE_PAGE, "saved-report.html");

    // The Previous/Next strip is the one thing that used to sit under the frame, and with it went a divider, a band of Leaftext's own spacing and two of Leaftext's own buttons inside somebody else's page.
    assert!(
        !document.html.contains("docs-pager"),
        "a Previous/Next strip was drawn under the page: {}",
        document.html
    );
    // The article holds the frame and nothing else, so the frame fills the reader to its bottom edge.
    assert_contains(&document.html, r#"></iframe></article>"#);

    let page = site_page_of(&document.html);
    assert_contains(&page, "html{scrollbar-width:none}");
    assert_contains(&page, "html::-webkit-scrollbar{width:0;height:0}");
}

/// A single-file page draws its icons once and points at that drawing from every place one goes. Keeping the drawing and dropping the two tags that hold it and point at it leaves the space each icon stands in and nothing in it.
#[test]
fn an_icon_drawn_from_a_sprite_survives() {
    const SPRITE: &str = r##"<!doctype html><html><body>
<svg class="sprite" aria-hidden="true"><defs><symbol id="home" viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/></symbol></defs></svg>
<svg class="icon"><use href="#home"/></svg>
<svg class="icon"><use href="https://elsewhere.example/sprite.svg#home"/></svg>
<svg class="icon"><use xlink:href="./neighbor.svg#home"/></svg>
</body></html>"##;

    let page = site_page_of(&opened_document_from_source(SPRITE, "saved-report.html").html);

    // The drawing, what holds it, and what points at it.
    for kept in [
        "<defs",
        "symbol",
        "id=\"home\"",
        "viewBox=\"0 0 24 24\"",
        "<path",
        "<use",
    ] {
        assert_contains(&page, kept);
    }
    // A use points inside this page and nowhere else: the two that named somewhere to fetch from lost the address rather than keeping it.
    assert_contains(&page, "href=\"#home\"");
    assert!(
        !page.contains("elsewhere.example") && !page.contains("neighbor.svg"),
        "a use element kept an address it would have fetched: {page}"
    );

    // The safe policy is a different boundary and keeps its own answer: raw HTML inside a note still crosses the one it crosses today.
    let note = sanitize_rendered_html(SPRITE);
    for gone in ["<defs", "<symbol", "<use"] {
        assert!(
            !note.contains(gone),
            "the note policy started keeping {gone}: {note}"
        );
    }
}

/// The page is drawn by its own CSS and by nothing else. Leaftext's head around it carries the four things it has to — how the bytes are spelled, how the frame is measured, what the page may reach, and what a relative address resolves against — plus the one rule that takes the frame's scrollbar away, and nothing more: no font, no color, no measure, no reset.
#[test]
fn the_head_of_ours_around_the_page_carries_nothing_that_styles_it() {
    let page = prepared_site_page("<p>Words</p>", Some("leaf-site://folder/"), true);
    let head = &page[..page.find("</head>").expect("the head closes")];

    // The one rule of ours inside the page, and the whole of it.
    let style = &head[head.find("<style>").expect("the head carries the rule")..];
    assert_eq!(
        style,
        "<style>html{scrollbar-width:none}html::-webkit-scrollbar{width:0;height:0}</style>"
    );

    // Everything else in the head is one of the four, so nothing arrives that a page's own CSS would have to fight.
    for tag in head.split("><") {
        assert!(
            tag.contains("<!doctype")
                || tag.contains("html")
                || tag.contains("head")
                || tag.contains("charset")
                || tag.contains("viewport")
                || tag.contains("Content-Security-Policy")
                || tag.contains("base ")
                || tag.contains("style"),
            "the head carries {tag}, which is neither the spelling, the measure, the policy, the base nor the scrollbar rule"
        );
    }
}

#[test]
fn the_page_carries_a_policy_of_its_own_and_a_base_of_ours() {
    let source = r#"<base href="https://elsewhere.example/"><meta http-equiv="Content-Security-Policy" content="default-src *"><p>Words</p>"#;
    let folder = std::env::temp_dir().join(format!("leaftext-site-base-{}", std::process::id()));
    let document = opened_document_from_source(source, folder.join("page.html"));
    let page = site_page_of(&document.html);

    assert_contains(&page, "content=\"default-src 'none';");
    // The page's own folder, and nothing on the network. Every one of these is where a page fetches from, so an `http` or `https` source among them would be a saved page phoning where it was saved from.
    for source in [
        "style-src 'unsafe-inline' ",
        "img-src data: ",
        "font-src data: ",
        "media-src ",
    ] {
        assert_contains(&page, &format!("{source}http://leaf-site.local leaf-site:"));
    }
    assert!(
        !page.contains("https://"),
        "the page may reach the network: {page}"
    );
    // One policy in the head, and it is ours. An author's own is only ever additive with it, and a page that could widen its own is not contained.
    assert_eq!(page.matches("Content-Security-Policy").count(), 1);
    assert!(!page.contains("default-src *"));
    // One base in the head, and it is ours. An author's would point every relative address in the page somewhere else.
    assert_eq!(page.matches("<base ").count(), 1);
    assert!(!page.contains("elsewhere.example"));
    assert_contains(&page, "<base href=\"http://leaf-site.local/");
}

#[test]
fn the_class_a_rule_matches_on_survives() {
    let source = r#"<style>.tag { color: rgb(1, 2, 3) }</style><p class="tag" id="first" style="margin: 0">Words</p>"#;
    let page = site_page_of(&opened_document_from_source(source, "styled.html").html);

    assert_contains(&page, r#"<p class="tag" id="first" style="margin: 0">"#);
    // The safe policy next door strips the same attribute, which is why keeping the CSS there would draw rules that match nothing.
    assert!(!sanitize_rendered_html(source).contains("class=\"tag\""));
}

#[test]
fn a_link_keeps_its_address_only_where_it_is_a_stylesheet() {
    let source = r#"<link rel="stylesheet" href="site.css"><link rel="preload" href="run.js" as="script"><link rel="icon" href="i.png">"#;
    let page = site_page_of(&opened_document_from_source(source, "linked.html").html);

    assert_contains(&page, r#"<link rel="stylesheet" href="site.css">"#);
    // The others keep no `rel`, so they are elements that fetch nothing rather than elements quietly allowed.
    assert!(!page.contains("preload"));
    assert!(!page.contains("rel=\"icon\""));
}

#[test]
fn the_file_names_a_page_that_does_not_name_itself() {
    assert_eq!(
        opened_document_from_source("<p>Words</p>", "saved-report.html").title,
        "Saved report"
    );
    // A tag whose name merely starts the same way is not the title.
    assert_eq!(
        opened_document_from_source("<titlebar>No</titlebar>", "saved-report.html").title,
        "Saved report"
    );
    assert_eq!(
        opened_document_from_source("<title lang=\"en\"> Spaced  out </title>", "a.html").title,
        "Spaced out"
    );
}

#[test]
fn a_broken_page_answers_with_a_page_rather_than_a_panic() {
    for source in [
        "<title>Half a",
        "<html><head><title>",
        "<p>unclosed",
        "<style>.a { color: red",
        "\u{feff}<html \u{0}>",
        "<title>\u{d55c}\u{ae00}</title><p>\u{d55c}\u{ae00}</p>",
        "<p>\u{1f600}</p><title>\u{1f600}",
    ] {
        let document = opened_document_from_source(source, "broken.html");
        assert_contains(&document.html, "<iframe class=\"document-site\"");
    }
}

#[test]
fn unsaved_html_source_edits_are_rendered_from_the_live_buffer() {
    let source = "<main><p>Before</p></main>";
    let mut editable = EditableDocument::new(
        PathBuf::from("saved-report.html"),
        SourceText::utf8(source.to_string()),
    );
    let start = source.find("Before").expect("the original words");
    assert!(editable.replace_range(start, start + "Before".len(), "After<script>bad()</script>"));
    assert!(editable.is_dirty());

    let page = site_page_of(&opened_document_from_source(editable.text(), &editable.path).html);
    assert_contains(&page, "<p>After</p>");
    assert!(!page.contains("bad()"));
    assert_eq!(editable.saved_text(), source);
}

/// What the rail's second frame costs, measured in a running copy rather than here — a layout is the web view's and Rust has none.
///
/// A 1,048,504-byte page laying out 906,905 pixels tall, forced to lay out seven times and taken at the median: **36.9 ms** for the reading frame alone, **77.6 ms** for that frame and the rail's second frame over the same page. So the rail costs about as much again as the page it mirrors.
///
/// It is paid once per render and never on a scroll: [`updateContainedPageMinimapPreview`] in `minimap.js` rebuilds only when the content version or the frame's width has moved, and scrolling only slides the box over the frame already built.
#[test]
#[ignore = "release-build measurement"]
fn measure_one_megabyte_html_render() {
    let paragraph = "<section><p>A safe exported paragraph with <strong>weight</strong> and <a href=\"https://example.com\">a link</a>.</p></section>";
    let mut source = "<!doctype html><html><body><main>".to_string();
    while source.len() + paragraph.len() + "</main></body></html>".len() <= 1024 * 1024 {
        source.push_str(paragraph);
    }
    source.push_str("</main></body></html>");

    let started = std::time::Instant::now();
    let safe = sanitize_rendered_html(&source);
    let safe_render = started.elapsed();
    assert_contains(&safe, "A safe exported paragraph");

    let started = std::time::Instant::now();
    let document = opened_document_from_source(&source, "one-megabyte.html");
    let contained = started.elapsed();
    assert_contains(&site_page_of(&document.html), "A safe exported paragraph");

    eprintln!(
        "1 MB HTML: safe render {safe_render:?}, contained page {contained:?} ({} source bytes)",
        source.len()
    );
    // The contained page runs the same shape of pass and escapes the result into one attribute, so it is held to the safe render's own order of magnitude rather than to a number of its own.
    assert!(
        contained < safe_render * 10,
        "the contained page cost {contained:?} against the safe render's {safe_render:?}"
    );
}
