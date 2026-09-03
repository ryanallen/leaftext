//! The documents the shared web core is proved against: one per format the app reads, plus the extras a host has to carry — diagrams, math, an editable source, and Scholar's own document shape.
//!
//! They render under a path that is not on this machine, so what comes back is the same on every machine: no repository above them, no glossary, no vault types, no images to measure.

use super::*;

/// One document, and the file name that decides which renderer reads it.
pub(super) struct WebCoreFixture {
    pub(super) name: &'static str,
    pub(super) file: &'static str,
    pub(super) source: &'static str,
}

/// A folder no machine has, so the walks above a fixture find nothing and every render is reproducible.
pub(super) fn web_core_fixture_path(file: &str) -> PathBuf {
    let root = if cfg!(windows) {
        r"C:\leaf-web-core-fixtures"
    } else {
        "/leaf-web-core-fixtures"
    };
    Path::new(root).join(file)
}

pub(super) const MARKDOWN_FIXTURE: &str = "---\ntitle: Notes\ndone: true\ntags: [one, two]\n---\n\n# Heading\n\nA paragraph with a [link](https://example.com) and `code`.\n\n- [x] a task\n- [ ] another\n\n| a | b |\n| :- | -: |\n| 1 | 2 |\n\n> [!NOTE]\n> An alert.\n\n```rust\nfn main() {}\n```\n\nA footnote.[^1]\n\n[^1]: The note.\n";

pub(super) const MERMAID_FIXTURE: &str =
    "# Diagram\n\n```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n";

pub(super) const MATH_FIXTURE: &str =
    "# Math\n\nInline $E = mc^2$ in a sentence.\n\n$$\n\\int_0^1 x^2\n$$\n";

pub(super) const XML_FIXTURE: &str = "<?xml version=\"1.0\"?>\n<library>\n  <book id=\"1\">\n    <title>A Book</title>\n    <author>Ada</author>\n  </book>\n</library>\n";

pub(super) const JSON_FIXTURE: &str =
    "{\n  \"title\": \"A Book\",\n  \"pages\": 42,\n  \"tags\": [\"one\", \"two\"],\n  \"open\": true\n}\n";

pub(super) const YAML_FIXTURE: &str =
    "title: A Book\npages: 42\ntags:\n  - one\n  - two\nopen: true\n";

pub(super) const EML_FIXTURE: &str = "From: Ada <ada@example.com>\nTo: Grace <grace@example.com>\nSubject: A message\nDate: Mon, 3 Aug 2026 09:00:00 +0000\nMIME-Version: 1.0\nContent-Type: text/plain; charset=utf-8\n\nOne short body.\n";

pub(super) const INI_FIXTURE: &str = "; a comment
editor = leaftext

[display]
font_size = 14
url = https://example.com/page#anchor
";

pub(super) const TEXT_FIXTURE: &str = "Notes
=====

    indented list
    another

a < b & c > d
";

pub(super) const HTML_FIXTURE: &str = "<!doctype html><html><body><main><h1>A page</h1><p>Safe words.</p><script>alert(1)</script></main></body></html>";

/// The document phase 4's source edits splice into: every block kind that has a byte range worth addressing.
pub(super) const SOURCE_EDIT_FIXTURE: &str = "# Title\n\nFirst paragraph.\n\n- one\n- two\n\n```js\nlet a = 1;\n```\n\n---\n\nLast paragraph.\n";

/// Scholar's RichDocument V1, in its own shape: version, then blocks of the seven kinds it defines.
pub(super) const SCHOLAR_RICH_DOCUMENT_FIXTURE: &str = r#"{
  "version": 1,
  "blocks": [
    { "type": "heading", "level": 1, "content": [{ "type": "text", "text": "Study notes" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "A line with " }, { "type": "strong", "content": [{ "type": "text", "text": "weight" }] }, { "type": "text", "text": " and " }, { "type": "code", "text": "code" }] },
    { "type": "list", "ordered": false, "items": [[{ "type": "text", "text": "one" }], [{ "type": "text", "text": "two" }]] },
    { "type": "table", "headers": [[{ "type": "text", "text": "a" }], [{ "type": "text", "text": "b" }]], "rows": [[[{ "type": "text", "text": "1" }], [{ "type": "text", "text": "2" }]]] },
    { "type": "quote", "content": [{ "type": "text", "text": "A quoted line." }] },
    { "type": "code", "language": "rust", "code": "fn main() {}" },
    { "type": "display-math", "latex": "\\int_0^1 x^2" }
  ]
}
"#;

pub(super) fn web_core_fixtures() -> Vec<WebCoreFixture> {
    vec![
        WebCoreFixture {
            name: "markdown",
            file: "notes.md",
            source: MARKDOWN_FIXTURE,
        },
        WebCoreFixture {
            name: "mermaid",
            file: "diagram.md",
            source: MERMAID_FIXTURE,
        },
        WebCoreFixture {
            name: "math",
            file: "math.md",
            source: MATH_FIXTURE,
        },
        WebCoreFixture {
            name: "source-edits",
            file: "editable.md",
            source: SOURCE_EDIT_FIXTURE,
        },
        WebCoreFixture {
            name: "xml",
            file: "library.xml",
            source: XML_FIXTURE,
        },
        WebCoreFixture {
            name: "json",
            file: "book.json",
            source: JSON_FIXTURE,
        },
        WebCoreFixture {
            name: "scholar-rich-document",
            file: "study.json",
            source: SCHOLAR_RICH_DOCUMENT_FIXTURE,
        },
        WebCoreFixture {
            name: "yaml",
            file: "book.yaml",
            source: YAML_FIXTURE,
        },
        WebCoreFixture {
            name: "eml",
            file: "message.eml",
            source: EML_FIXTURE,
        },
        WebCoreFixture {
            name: "html",
            file: "page.html",
            source: HTML_FIXTURE,
        },
        WebCoreFixture {
            name: "text",
            file: "plain.txt",
            source: TEXT_FIXTURE,
        },
        WebCoreFixture {
            name: "ini",
            file: "settings.ini",
            source: INI_FIXTURE,
        },
    ]
}

/// A document carrying all four things the render cannot work out from its own text. `ready` is worded so nothing about the value says it is a box — only the vault does, which is what makes it a host answer rather than an inference.
const DECORATED_FIXTURE: &str =
    "---\nready: sometime\n---\n\n# Notes\n\nSee #123, and a tab is worth knowing.\n\n![A picture](picture.png)\n";

/// A host with no disk under it: every answer is handed over, and the four decorations have to come from here or not at all.
struct HandedHost;

impl LeafHost for HandedHost {
    fn field_types(&self, _document: &Path) -> store::TypeOverrides {
        let mut types = store::TypeOverrides::default();
        types.insert("ready", store::FieldType::Checkbox);
        types
    }

    fn repository(&self, _document_dir: &Path) -> Option<RepositoryContext> {
        Some(RepositoryContext {
            owner: "ryanallen".to_string(),
            repo: "leaftext".to_string(),
        })
    }

    fn image_size(&self, _image: &Path) -> Option<(u32, u32)> {
        Some((640, 480))
    }

    fn glossary_terms(&self, _document_dir: &Path) -> Vec<GlossaryTerm> {
        vec![GlossaryTerm {
            term: "tab".to_string(),
            slug: "tab".to_string(),
        }]
    }
}

/// The four reads are the host's, not the renderer's: nothing here is on this machine, and all four still land.
#[test]
fn a_host_that_hands_over_the_four_reads_gets_all_four_decorations() {
    let path = web_core_fixture_path("decorated.md");
    let html = opened_document_from_markdown_with_host(DECORATED_FIXTURE, &path, &HandedHost).html;

    assert_contains(&html, r#"<input type="checkbox" disabled="">"#);
    assert_contains(&html, "https://github.com/ryanallen/leaftext/issues/123");
    assert_contains(&html, r#"width="640" height="480""#);
    assert_contains(&html, r#"href="glossary:tab""#);
}

/// And a host that answers none of them renders the same document without those four, rather than failing — which is the whole bargain a browser is offered.
#[test]
fn a_host_with_no_answers_renders_the_document_without_those_decorations() {
    let path = web_core_fixture_path("decorated.md");
    let html = opened_document_from_markdown_with_host(DECORATED_FIXTURE, &path, &BareHost).html;

    assert_contains(&html, "<h1");
    assert_contains(&html, "Notes");
    assert!(!html.contains("github.com"), "html: {html}");
    assert!(!html.contains("width=\"640\""), "html: {html}");
    assert!(!html.contains("glossary:"), "html: {html}");
    // The field is still drawn, as the text it looks like — only the vault's word on its type is missing.
    assert_contains(&html, ">sometime</td>");
    assert!(!html.contains(r#"<input type="checkbox""#), "html: {html}");
}

/// Every fixture renders through a host with nothing under it, so the boundary holds for every format rather than for Markdown alone.
#[test]
fn every_fixture_renders_through_a_host_with_no_disk() {
    for fixture in web_core_fixtures() {
        let path = web_core_fixture_path(fixture.file);
        let document = opened_document_from_source_with_host(fixture.source, &path, &BareHost);

        assert!(
            document.html.contains("<article class=\"document-body\""),
            "the {} fixture rendered nothing through a bare host: {}",
            fixture.name,
            document.html
        );
    }
}

/// A host that answers nothing refuses out loud rather than pretending the file was missing, so a caller can tell "this host cannot" from "there is no such document".
#[test]
fn a_host_with_no_answers_refuses_a_command_rather_than_faking_one() {
    let path = web_core_fixture_path("notes.md");

    let refusal = BareHost
        .load(&path)
        .expect_err("a host with no disk cannot load a document");
    assert_eq!(refusal.kind(), std::io::ErrorKind::Unsupported);

    assert!(BareHost.asset_url("app.js").is_none());
    assert!(BareHost.highlighter_url().is_none());
    let query = Query::parse("anything", utc_today());
    assert!(BareHost
        .search(&query, None, &|| false)
        .is_some_and(|results| results.hits.is_empty()));
    assert!(BareHost
        .graph(&path, &store::GraphRequest::default())
        .nodes
        .is_empty());
}

/// The commands the desktop answers off its own disk, so the interface is not a set of names nothing implements. Load, save and the asset lookup all go through the host and come back with what the old path produced.
#[test]
fn the_desktop_answers_its_commands_through_the_host() {
    let dir = scratch_dir("web-core");
    let path = dir.join("notes.md");
    fs::write(&path, MARKDOWN_FIXTURE).expect("fixture is written");
    let host = DesktopHost::default();

    // The same document the old call gives, fixture by fixture rather than by hand.
    let through_host = host.load(&path).expect("the desktop reads its own disk");
    let direct = load_document(&path).expect("the old path reads the same file");
    assert_eq!(through_host.html, direct.html);
    assert_eq!(through_host.title, direct.title);
    assert_eq!(through_host.format, DocumentFormat::Markdown);

    // A save through the host lands the same bytes the old call would write.
    let saved = dir.join("saved.md");
    host.save(&saved, &SourceText::utf8("# Saved\n".to_string()))
        .expect("the desktop writes its own disk");
    assert_eq!(
        fs::read(&saved).expect("the saved file is readable"),
        b"# Saved\n"
    );

    let asset = host
        .asset_url("app.js")
        .expect("the desktop serves its own assets");
    assert!(asset.contains("app.js"), "asset url: {asset}");
    // Versioned, so a new binary is never answered out of an old binary's year-long cache entry — the stored headers would re-mask every page error.
    assert!(
        asset.contains(&format!("?v={}", env!("CARGO_PKG_VERSION"))),
        "asset url carries no version: {asset}"
    );

    // The desktop compiles the highlighter in, so it has no second module to fetch.
    assert!(host.highlighter_url().is_none());

    fs::remove_dir_all(&dir).ok();
}

/// The reader's settings survive a round trip through the host, which is the only reason the page can keep any: its origin has no storage.
#[test]
fn the_desktop_reads_and_writes_settings_through_the_host() {
    let dir = scratch_dir("web-core-settings");
    let settings_path = dir.join("settings.json");
    let host = DesktopHost {
        settings_path: Some(&settings_path),
        ..DesktopHost::default()
    };

    let mut settings = host.settings();
    settings.speed_reader_enabled = !settings.speed_reader_enabled;
    host.set_settings(&settings);

    assert_eq!(host.settings(), settings);
    assert_eq!(load_settings(&settings_path).settings, settings);

    fs::remove_dir_all(&dir).ok();
}

/// Search goes through the host too, and answers off the vault text the running app already holds rather than reading the folder again.
#[test]
fn the_desktop_searches_the_vault_it_was_handed() {
    let dir = scratch_dir("web-core-search");
    fs::write(dir.join("notes.md"), MARKDOWN_FIXTURE).expect("fixture is written");

    let vault = VaultCorpus::read(&dir);
    let host = DesktopHost {
        vault: Some(&vault),
        ..DesktopHost::default()
    };

    let query = Query::parse("heading", utc_today());
    let results = host
        .search(&query, None, &|| false)
        .expect("the scan was not overtaken");
    assert!(!results.hits.is_empty());

    // Without a vault handed over there is nothing bounded to read, so it answers nothing rather than crawling.
    assert!(DesktopHost::default()
        .search(&query, None, &|| false)
        .is_none());

    // A query nobody will read any more stops rather than finishing.
    assert!(host.search(&query, None, &|| true).is_none());

    fs::remove_dir_all(&dir).ok();
}

/// The desktop's highlighter and the browser's are the same syntax dumps over different regex engines — the desktop's is a C library with no browser build. So the markup itself is pinned in one file both sides read, and this is the desktop's half; `scripts/build-web.mjs` holds the module to the same string.
#[test]
fn a_fence_highlights_to_the_markup_both_engines_have_to_agree_on() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!("../../web/fence.json"))
        .expect("the fence fixture reads");
    let markdown = fixture["markdown"].as_str().expect("a fence to render");
    let expected = fixture["code_html"].as_str().expect("the markup to match");

    let html = opened_document_from_markdown_with_host(
        markdown,
        web_core_fixture_path("fence.md"),
        &BareHost,
    )
    .html;

    assert!(
        html.contains(expected),
        "the desktop highlights this fence differently now, so the browser module and this one no longer agree.\nexpected:\n{expected}\n\nrendered:\n{html}"
    );
}

/// A waiting state is a promise. The desktop can keep it — it walks the folder and fills the strip in — and a host that cannot see a document's neighbors never draws one, rather than leaving a skeleton that spins for ever.
#[test]
fn only_a_host_that_can_find_the_neighbors_draws_the_previous_next_strip() {
    for fixture in web_core_fixtures() {
        let path = web_core_fixture_path(fixture.file);

        let desktop = opened_document_from_source(fixture.source, &path);
        assert!(
            desktop.html.contains("docs-pager-loading"),
            "the {} fixture lost the desktop's waiting strip",
            fixture.name
        );

        let bare = opened_document_from_source_with_host(fixture.source, &path, &BareHost);
        assert!(
            !bare.html.contains("docs-pager"),
            "the {} fixture drew a Previous/Next strip nothing can fill:
{}",
            fixture.name,
            bare.html
        );
    }
}

/// A picture beside the document reaches the reader by whichever route its host can serve, and there are three of them. The desktop's page is loaded from a scheme where a relative path resolves against nothing, so every local image is rewritten to `leaf-image://` and served off disk. A document inside somebody else's page is fetched over http from beside its own pictures, so the path as written is already the path that works and rewriting it there is a broken picture on every page that has one. A published site is neither: its page sits at the top and its documents sit under a folder, so a picture is reached through that folder joined with the document's own.
#[test]
fn a_browser_leaves_a_pictures_path_the_way_the_document_wrote_it() {
    let source = "![The window](imgs/leaftext.png)\n\n<img src=\"imgs/raw.png\" alt=\"Raw\">\n";
    let path = Path::new("docs/README.md");

    let desktop = opened_document_from_source(source, path);
    assert!(
        desktop.html.contains("leaf-image"),
        "the desktop stopped serving a document's own folder:\n{}",
        desktop.html
    );

    let browser = opened_document_from_source_with_host(source, path, &BareHost);
    assert!(
        !browser.html.contains("leaf-image"),
        "a browser was handed a scheme it cannot fetch:\n{}",
        browser.html
    );
    for written in ["src=\"imgs/leaftext.png\"", "src=\"imgs/raw.png\""] {
        assert!(
            browser.html.contains(written),
            "an embedded document lost {written}:\n{}",
            browser.html
        );
    }

    let site = opened_document_from_source_with_host(source, path, &ServedDocumentsHost);
    assert!(
        !site.html.contains("leaf-image"),
        "a published site was handed a scheme it cannot fetch:\n{}",
        site.html
    );
    for expected in [
        "src=\"source/docs/imgs/leaftext.png\"",
        "src=\"source/docs/imgs/raw.png\"",
    ] {
        assert!(
            site.html.contains(expected),
            "a published site asked for something other than {expected}:\n{}",
            site.html
        );
    }
}

/// A host serving its documents under a folder of its own, the way the exported site serves them under `source/`.
pub(super) struct ServedDocumentsHost;

impl LeafHost for ServedDocumentsHost {
    fn served_documents_url(&self) -> Option<String> {
        Some(String::from("source"))
    }
}

/// The page a browser is served is the desktop's page with the host's own asset addresses in it. Nothing else about it may differ, or the two are two pages.
#[test]
fn the_page_takes_its_asset_addresses_from_the_host() {
    struct ServedHost;
    impl LeafHost for ServedHost {
        fn asset_url(&self, name: &str) -> Option<String> {
            Some(format!("assets/{name}"))
        }
    }

    let served = app_shell_html_for_host(&ServedHost);

    assert_contains(&served, r#"src="assets/app.js""#);
    assert_contains(&served, r#"href="assets/app.css""#);
    assert_contains(&served, r#"href="assets/katex/katex.min.css""#);
    // The vendored runtimes are fetched by name at the moment a document needs one, so their addresses are the host's too.
    assert_contains(&served, r#""mermaid":"assets/mermaid.min.js""#);
    // No address on the page is the desktop's own scheme. The security policy still names it, because that line is the page's and is the same everywhere.
    assert!(
        !served.contains(r#"src="leaf-asset"#) && !served.contains(r#"href="leaf-asset"#),
        "the desktop's own scheme reached a page that is not the desktop's:
{served}"
    );

    // And the desktop's page still serves its own.
    assert_contains(&app_shell_html(), "leaf-asset");
}

/// A browser host boots after the app's own front end, and that order is the host's rather than ours to move.
///
/// The desktop appends its front end a painted frame after the page draws, which is the whole of [the first-screen work](../../../docs/refactor/reading/the-page-draws-its-first-screen-before-the-front-end-runs.md) — and a browser page must not follow it there. A published site puts its module boot under this tag and an embedded document puts its own host under it, both of them counting on the front end already standing; delayed, the two would start against a page with no app in it. So the tag stays where it has always been, deferred, last on the page and reached by the parser.
#[test]
fn a_browser_page_keeps_the_front_end_tag_the_parser_reaches() {
    struct ServedHost;
    impl LeafHost for ServedHost {
        fn asset_url(&self, name: &str) -> Option<String> {
            Some(format!("assets/{name}"))
        }
    }

    let served = app_shell_html_for_host(&ServedHost);

    assert_contains(
        &served,
        r#"<script src="assets/app.js" crossorigin="anonymous" defer></script>"#,
    );
    // Nothing appends it instead: the desktop's loader is the desktop's alone.
    assert!(
        !served.contains("runFrontEnd"),
        "the desktop's loader reached a page that is not the desktop's:\n{served}"
    );
}

/// A glossary reaches a host with no disk as text, so the reading has to work on text alone — it is the same reading either way.
#[test]
fn a_glossary_is_read_from_text_the_same_as_from_a_file() {
    let terms = glossary_terms_in(
        "# Words

## Tab

One.

## Reading view

Two.
",
    );

    // Longest first, so a multi-word term matches before its own substring.
    assert_eq!(
        terms,
        vec![
            GlossaryTerm {
                term: "Reading view".to_string(),
                slug: "reading-view".to_string(),
            },
            GlossaryTerm {
                term: "Tab".to_string(),
                slug: "tab".to_string(),
            },
        ]
    );
    assert!(glossary_terms_in("no headings here").is_empty());
}

/// A tab is named by its file, not by the document's heading — two notes titled the same are still two files.
#[test]
fn a_tab_is_named_by_its_file() {
    assert_eq!(
        tab_title_from_path(Path::new("notes/01-rendering.md")),
        "01-rendering"
    );
    assert_eq!(tab_title_from_path(Path::new("README")), "README");
}

/// Every format the app reads has a fixture, so a boundary proved against this set is proved against the whole format table.
#[test]
fn the_fixture_set_covers_every_format_the_app_reads() {
    let covered: Vec<DocumentFormat> = web_core_fixtures()
        .iter()
        .map(|fixture| DocumentFormat::from_path(&web_core_fixture_path(fixture.file)))
        .collect();

    for format in [
        DocumentFormat::Markdown,
        DocumentFormat::Xml,
        DocumentFormat::Json,
        DocumentFormat::Yaml,
        DocumentFormat::Eml,
        DocumentFormat::Html,
        DocumentFormat::Text,
        DocumentFormat::Ini,
    ] {
        assert!(
            covered.contains(&format),
            "no web-core fixture renders {format:?}"
        );
    }
}

/// What a fixture renders to, as one short string. The whole HTML is printed when one disagrees, so a change is still readable; keeping the markup itself in here would be thousands of characters nobody reads until it breaks.
pub(super) fn web_core_render_digest(document: &OpenedDocument) -> String {
    blake3::hash(
        format!(
            "{}\n{}\n{}\n{}",
            document.title,
            document.blocks.len(),
            document.tasks.len(),
            document.html
        )
        .as_bytes(),
    )
    .to_hex()
    .to_string()
}

/// What each fixture rendered to before the host boundary was drawn, taken on 6 August 2026. Nothing in that work is allowed to move one of these.
///
/// The markdown one has moved since, on purpose: it is the only fixture with a leading field block, and its two fences were reported as blocks the page has no element for, which cost that document every editable range it had. Same title, same HTML, two fewer blocks.
///
/// So has the xml one: every value the file keeps inside a tag now carries the bytes between its quotes, and the values composed into one run are drawn in an element each so a press can name one of them. Same title, same blocks, more names on the markup.
///
/// And the markdown one again: every body cell of a table now carries its column's heading, which is what lets a narrowed table draw its rows as labeled cards on all three hosts. Same title, same blocks, an attribute on each cell.
///
/// And the four data ones: a JSON, YAML or config page carried `data-block-id` and `data-block-kind` on every block, and neither said anything about the file — the id's number was read nowhere at all, and the kind is what the tag the block is drawn with already says, which is where the page reads it now (`dataBlockKindOf`). Same title, same blocks, same source ranges; a block with no range now carries no attribute at all, and a large config page loses about 30% of its bytes.
///
/// And every fixture: the render now carries the waiting Previous and Next strip that the host fills after the document arrives. Same titles, blocks and tasks; one navigation block appended.
const WEB_CORE_RENDERS: &[(&str, &str)] = &[
    (
        "markdown",
        "dfa8643b728a817b65d18e68a028627470f11a42d29f6c1fdea2af349e30fe13",
    ),
    (
        "mermaid",
        "b6ea63c812787527eda44011c9a6b2e4e03be8f30ae786ae9350758b00ad20f4",
    ),
    (
        "math",
        "f91c56424200cbda779a4d2732fa59658b65831883d548894eeb68b4b38a9203",
    ),
    (
        "source-edits",
        "564a32a9e37a415078acf83599dfc65cfa1cbca2a708e54fc8b5719cea61e2bb",
    ),
    (
        "xml",
        "be7895a611b6f026a620a7d0eb872c30ec5792530e2f8c74299f0a1487be0155",
    ),
    (
        "json",
        "da10e7f8f9102b2c012935b11b4a45b4592e6ea749625536df11bf128f63834e",
    ),
    (
        "scholar-rich-document",
        "a40c90148be52793002051c1ef7c33c1ac292bf65759384666c459c271138816",
    ),
    (
        "yaml",
        "5eb422d16077f1e38a957f308a89e27f604de342fe668056aa3b9b020b76dcf5",
    ),
    (
        "eml",
        "b9c668f33cfbfd5a82b04676752b03d0c77505362d6754fda9d093c759324724",
    ),
    (
        "html",
        "0188116ace3f436bdbfdf4ada04315e2ae763a5318c772a78831f1b88d74da30",
    ),
    (
        "text",
        "a81c579cf465bac3ef844989557300d810bc43030a0f8f584a6f31966554e8ea",
    ),
    (
        "ini",
        "e1705325fef1a250f183d6050765236ad4f03b2c30674dc9f158d8afb4d46916",
    ),
];

#[test]
fn the_desktop_renders_every_fixture_exactly_as_it_did_before_the_boundary() {
    for fixture in web_core_fixtures() {
        let expected = WEB_CORE_RENDERS
            .iter()
            .find(|(name, _)| *name == fixture.name)
            .map(|(_, digest)| *digest)
            .unwrap_or_else(|| panic!("no recorded render for the {} fixture", fixture.name));
        let path = web_core_fixture_path(fixture.file);
        let document = opened_document_from_source(fixture.source, &path);

        assert_eq!(
            web_core_render_digest(&document),
            expected,
            "the {} fixture renders differently now:\ntitle: {}\nblocks: {}\ntasks: {}\nhtml:\n{}",
            fixture.name,
            document.title,
            document.blocks.len(),
            document.tasks.len(),
            document.html
        );
    }
}

/// The browser module holds a document buffer an edit splices into, and the arithmetic under it is this same [`EditableDocument`]. What could quietly differ is the dispatch on top: which call an edit reaches, with which offsets, in what order. So every kind of edit is walked through one buffer and the text after each is pinned in `web/buffer.json`.
///
/// This is the desktop's half — the same methods the binary's own editing arms call, in the same order. `scripts/build-web.mjs` walks the same file through the built module, so a dispatch that reached another call comes back with different text there rather than agreeing by luck.
#[test]
fn a_buffer_edit_lands_on_the_bytes_both_sides_have_to_agree_on() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!("../../web/buffer.json"))
        .expect("the buffer fixture reads");
    let documents = fixture["documents"].as_array().expect("documents to walk");
    let mut wrong = Vec::new();

    for document in documents {
        let source = document["source"].as_str().expect("a document to edit");
        let path = PathBuf::from(document["path"].as_str().unwrap_or("notes.md"));
        let name = path.display().to_string();
        let steps = document["steps"].as_array().expect("steps to walk");
        let mut edit = EditableDocument::new(path, SourceText::utf8(source.to_string()));

        for (at, step) in steps.iter().enumerate() {
            let what = step["what"].as_str().unwrap_or("");
            let before = edit.text().to_string();
            apply_pinned_buffer_edit(&mut edit, step);
            let changed = edit.text() != before;

            let expected_change = step["changed"].as_bool().unwrap_or(true);
            if changed != expected_change {
                wrong.push(format!(
                    "  {name} step {at} ({what}) says changed: {expected_change} and the buffer {}",
                    if changed { "moved" } else { "did not move" }
                ));
            }
            match step["text"].as_str() {
                Some(expected) if expected == edit.text() => {}
                _ => wrong.push(format!(
                    "  {name} step {at} ({what}) is pinned as {} and the buffer now holds {}",
                    step["text"],
                    serde_json::Value::String(edit.text().to_string())
                )),
            }
        }
    }

    assert!(
        wrong.is_empty(),
        "web/buffer.json no longer describes what a buffer edit does:\n{}",
        wrong.join("\n")
    );
}

/// One pinned step, applied the way the desktop's own editing arms apply it. A step names its block by something that block's source contains and a splice by the text it lands after, so nothing here carries an offset a step above it would have shifted.
#[cfg(test)]
fn apply_pinned_buffer_edit(edit: &mut EditableDocument, step: &serde_json::Value) {
    let number = |name: &str| step[name].as_u64().unwrap_or_default() as usize;
    let text = |name: &str| step[name].as_str().unwrap_or_default();
    let range = |edit: &EditableDocument, marker: &str| {
        edit.block_source_map()
            .into_iter()
            .find(|span| {
                edit.text()
                    .get(span.start..span.end)
                    .is_some_and(|source| source.contains(marker))
            })
            .map(|span| (span.start, span.end))
            .unwrap_or_else(|| panic!("no block in the buffer holds {marker:?}"))
    };

    match step["kind"].as_str() {
        Some("splice") => {
            let marker = text("after");
            let at = edit
                .text()
                .find(marker)
                .map(|byte| byte + marker.len())
                .unwrap_or_else(|| panic!("the buffer does not hold {marker:?}"));
            let start = edit.text()[..at].chars().map(char::len_utf16).sum();
            edit.splice_utf16_without_undo(start, number("removed"), text("inserted"));
        }
        Some("task") => {
            edit.toggle_task_without_undo(number("index"));
        }
        Some("block") => {
            let (start, end) = range(edit, text("block"));
            // A step marked `continuing` is a splice of a typing run after its first: the run's own first splice is the undo point, so the rest record nothing and one press takes the whole run back.
            if step["continuing"].as_bool().unwrap_or(false) {
                edit.replace_range_without_undo(start, end, text("text_in"));
            } else {
                edit.replace_range(start, end, text("text_in"));
            }
        }
        Some("blocks") => {
            let replacements: Vec<(usize, usize, &str)> = step["blocks"]
                .as_array()
                .expect("blocks to replace")
                .iter()
                .map(|block| {
                    let (start, end) = range(edit, block["block"].as_str().unwrap_or_default());
                    (start, end, block["text_in"].as_str().unwrap_or_default())
                })
                .collect();
            edit.replace_ranges(&replacements);
        }
        // A workbook's cell is named by its own element rather than by a block, because the buffer here is a sheet member and the blocks over it are rows, not cells.
        Some("sheet_cell") => {
            let element = text("element");
            let start = edit
                .text()
                .find(element)
                .unwrap_or_else(|| panic!("the buffer does not hold {element:?}"));
            edit.replace_sheet_cell(start, start + element.len(), text("text_in"));
        }
        Some("cell") => {
            let (start, end) = range(edit, text("block"));
            if !edit.replace_table_cell(
                start,
                number("row"),
                number("column"),
                number("columns"),
                text("cell_text"),
                true,
            ) {
                edit.replace_range(start, end, text("text_in"));
            }
        }
        Some("move") => {
            let ranges: Vec<(usize, usize)> = step["blocks"]
                .as_array()
                .expect("blocks to move")
                .iter()
                .map(|marker| range(edit, marker.as_str().unwrap_or_default()))
                .collect();
            edit.move_blocks(&ranges, number("from"), number("to"));
        }
        Some("field") => {
            let key = text("key");
            let splice = if let Some(value) = step["set"].as_str() {
                crate::store::set_field(edit.text(), key, value)
            } else if let Some(items) = step["items"].as_array() {
                let items: Vec<&str> = items.iter().filter_map(|item| item.as_str()).collect();
                crate::store::set_list_field(edit.text(), key, &items)
            } else if let Some(to) = step["rename"].as_str() {
                crate::store::rename_field(edit.text(), key, to)
            } else {
                crate::store::remove_field(edit.text(), key)
            };
            if let Some(splice) = splice {
                edit.replace_range(splice.range.start, splice.range.end, &splice.text);
            }
        }
        Some("undo") => {
            edit.undo();
        }
        Some("redo") => {
            edit.redo();
        }
        // A step the buffer knows nothing about, which has to move nothing rather than doing something near it.
        _ => {}
    }
}

/// The line a browser sends its page when a document opens, over the document's **bytes** — which is the only shape a packaged format has, because a Word, Excel, PowerPoint or OpenDocument file is a zip. What the exported site calls is `leaf_document_script_bytes`; this is the pair of calls that entry is: the document read off bytes, and the workspace line drawn around it.
///
/// Both halves matter. A package has to arrive with its own heading rather than as the parse error the XML reader gives zip noise, and a text file has to arrive saying exactly what it says when it is handed over as text — otherwise every ordinary document on an exported site would change the day this call did.
#[test]
fn the_browsers_document_line_draws_a_word_file_and_leaves_a_text_file_alone() {
    let word = super::office::sample_docx();
    let path = web_core_fixture_path("report.docx");
    let drawn = opened_document_from_bytes_with_host(&word, &path, &BareHost)
        .expect("a Word file's bytes are a document a browser can draw");
    assert_eq!(drawn.title, "Quarterly report");
    assert!(
        drawn.html.contains("Sales rose in every region"),
        "the Word file drew without its own words: {}",
        drawn.html
    );
    assert!(
        !drawn.html.contains("parse error"),
        "the Word file drew as the parse error the XML reader gives zip noise, which is what a page reading it as text got"
    );

    let line = workspace_state_script(
        &[],
        &Favorites::default(),
        &[TabSummary {
            title: tab_title_from_path(&path),
            path: path.display().to_string(),
            dirty: false,
            undoable: false,
            redoable: false,
            untitled: false,
        }],
        Some(0),
        Some(&drawn),
        Some(0x1234),
    );
    assert!(
        line.contains("Quarterly report"),
        "the line the page is sent carries no heading from the document it opened"
    );

    // A text file, both ways round: bytes and text have to draw the same document, or moving the exported site onto bytes would quietly redraw every page on it.
    let plain = web_core_fixture_path("plain.txt");
    let from_bytes =
        opened_document_from_bytes_with_host(TEXT_FIXTURE.as_bytes(), &plain, &BareHost)
            .expect("a text file's bytes are a document too");
    let from_text = opened_document_from_source_with_host(TEXT_FIXTURE, &plain, &BareHost);
    assert_eq!(from_bytes.html, from_text.html);
    assert_eq!(from_bytes.title, from_text.title);

    // Bytes no format can read are refused rather than drawn as something. A page that gets nothing back says the site cannot read the file; a page handed a document says the file is broken.
    assert!(
        opened_document_from_bytes_with_host(b"not a zip at all", &path, &BareHost).is_err(),
        "a .docx that is not an archive was drawn as a document rather than refused"
    );
}

/// A published site and the window draw a text file the same way: one preformatted block holding the file as typed. The block is the only thing on the page, so a browser drawing it differently would be drawing a different document rather than the same one missing a decoration.
#[test]
fn a_browser_draws_a_text_file_as_the_same_block_the_window_does() {
    let path = web_core_fixture_path("plain.txt");
    let desktop = opened_document_from_source(TEXT_FIXTURE, &path);
    let browser = opened_document_from_source_with_host(TEXT_FIXTURE, &path, &BareHost);

    let block = |html: &str| {
        html.split_once("<pre><code>")
            .expect("the file is drawn as one preformatted block")
            .1
            .split_once("</code></pre>")
            .expect("and that block closes")
            .0
            .to_string()
    };
    assert_eq!(block(&desktop.html), block(&browser.html));
    assert_eq!(
        block(&browser.html),
        "Notes\n=====\n\n    indented list\n    another\n\na &lt; b &amp; c &gt; d\n"
    );
    assert!(browser.blocks.is_empty());
}
