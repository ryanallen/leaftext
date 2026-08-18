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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("a clock after 1970")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-web-core-{unique}"));
    fs::create_dir_all(&dir).expect("fixture directory is created");
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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("a clock after 1970")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-web-core-settings-{unique}"));
    fs::create_dir_all(&dir).expect("fixture directory is created");
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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("a clock after 1970")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-web-core-search-{unique}"));
    fs::create_dir_all(&dir).expect("fixture directory is created");
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

/// A picture beside the document reaches the reader by whichever route its host can serve. The desktop's page is loaded from a scheme where a relative path resolves against nothing, so every local image is rewritten to `leaf-image://` and served off disk; a browser fetches the document over http from beside its own pictures, so the path as written is already the path that works, and rewriting it there is a broken picture on every page that has one.
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
            "a browser lost {written} out of the document:\n{}",
            browser.html
        );
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
const WEB_CORE_RENDERS: &[(&str, &str)] = &[
    (
        "markdown",
        "1e836f606aaebf4e88ea876b3d54cc0d7d22dbe942f81736668a99abd19e7a88",
    ),
    (
        "mermaid",
        "b5c44c856f6577ddc70c645d393f6f25093a70a24f52127d6879dacaae06346b",
    ),
    (
        "math",
        "5e30232a0113744e95fe1609f7286a0dc9caca25b16777b6fb2d8f358e8f0e0f",
    ),
    (
        "source-edits",
        "27cf111f37698ccbee098746437232845ff08b95964be6ba8eae850ca7f7b88e",
    ),
    (
        "xml",
        "e2395c9f5067df1db347fd70ff9a3e8e69bfb3bf253bd83c07beedd403059eb6",
    ),
    (
        "json",
        "a9276f215a8059b7d367f6da5ac042474431c799f6de33aa7f899a7181141640",
    ),
    (
        "scholar-rich-document",
        "9b70d0338a0b8a2a5bdda49c4f6d468ae24ba3523e60afd5e84cd87dacbc7f4e",
    ),
    (
        "yaml",
        "2b47c9f8b49f33476a3ee52ded06a49b46516924ad0881fa08464f227aced98a",
    ),
    (
        "eml",
        "508de6aae4b4b251f66c1de14e102a04780c64af1ec4b442294f1adb2bca1936",
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
    let source = fixture["source"].as_str().expect("a document to edit");
    let path = PathBuf::from(fixture["path"].as_str().unwrap_or("notes.md"));
    let steps = fixture["steps"].as_array().expect("steps to walk");

    let mut edit = EditableDocument::new(path, SourceText::utf8(source.to_string()));
    let mut wrong = Vec::new();

    for (at, step) in steps.iter().enumerate() {
        let what = step["what"].as_str().unwrap_or("");
        let before = edit.text().to_string();
        apply_pinned_buffer_edit(&mut edit, step);
        let changed = edit.text() != before;

        let expected_change = step["changed"].as_bool().unwrap_or(true);
        if changed != expected_change {
            wrong.push(format!(
                "  step {at} ({what}) says changed: {expected_change} and the buffer {}",
                if changed { "moved" } else { "did not move" }
            ));
        }
        match step["text"].as_str() {
            Some(expected) if expected == edit.text() => {}
            _ => wrong.push(format!(
                "  step {at} ({what}) is pinned as {} and the buffer now holds {}",
                step["text"],
                serde_json::Value::String(edit.text().to_string())
            )),
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
        // A step the buffer knows nothing about, which has to move nothing rather than doing something near it.
        _ => {}
    }
}
