//! Prev/Next paging: the label rule, and which files are pages.

use super::*;

#[test]
fn pager_loaded_script_routes_through_webview_hook() {
    let path = PathBuf::from("docs").join("guide.md");
    let script = pager_loaded_script(&path, r#"<nav class="docs-pager"></nav>"#);

    assert!(script.starts_with("window.leafSetPager({"));
    assert_contains(&script, "guide.md");
    assert_contains(&script, r#""html":"<nav class=\"docs-pager\"></nav>""#);
}

#[test]
fn pager_label_matches_web_label_rule() {
    assert_eq!(
        pager_label("book-1-words-of-the-buddha--kangyur"),
        "Book 1 Words Of The Buddha Kangyur"
    );
    assert_eq!(pager_label("going-forth.md"), "Going Forth");
    assert_eq!(pager_label("get_started"), "Get Started");
    // TEI XML chapters are pager pages too; their extension is stripped.
    assert_eq!(
        pager_label("001-001_toh1-1_chapter_on_going_forth.xml"),
        "001 001 Toh1 1 Chapter On Going Forth"
    );
    // So are the data formats, and so is theirs.
    assert_eq!(pager_label("release-notes.json"), "Release Notes");
    assert_eq!(pager_label("build_matrix.yaml"), "Build Matrix");
    assert_eq!(pager_label("deploy.yml"), "Deploy");
    // A name whose tail is not a page extension keeps it, dots and all.
    assert_eq!(pager_label("v0.1.380"), "V0.1.380");
}

#[test]
fn pager_includes_tei_xml_documents() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-pager-xml-{unique}"));
    let book = root.join("book-1-going-forth--pravrajyavastu");
    fs::create_dir_all(&book).expect("tree is created");
    fs::write(root.join("README.md"), "# Root\n").expect("root README written");
    fs::write(book.join("README.md"), "# Book\n").expect("book README written");
    // Two XML chapters plus a Markdown one, to prove XML both appears in the order and pages to its neighbors.
    let ch1 = book.join("001-going-forth.xml");
    let ch2 = book.join("002-ordination.xml");
    let notes = book.join("003-notes.md");
    for (p, body) in [(&ch1, "<TEI/>"), (&ch2, "<TEI/>")] {
        fs::write(p, body).expect("xml chapter written");
    }
    fs::write(&notes, "# Notes\n").expect("md chapter written");

    // Standing on the first XML chapter: next is the second XML chapter.
    let html = pager_html(&ch1);
    // Standing on the second XML chapter: prev is the first, next is the md.
    let html_mid = pager_html(&ch2);
    fs::remove_dir_all(&root).expect("tree removed");

    assert!(
        html.contains(r#"class="docs-pager-next""#) && html.contains("002 Ordination"),
        "an XML chapter should page to the next document: {html}"
    );
    assert!(
        html_mid.contains("001 Going Forth") && html_mid.contains("003 Notes"),
        "the XML chapter should sit between its neighbors: {html_mid}"
    );
}

#[test]
fn pager_includes_json_and_yaml_documents() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-pager-data-{unique}"));
    fs::create_dir_all(&root).expect("tree is created");
    fs::write(root.join("README.md"), "# Root\n").expect("root README written");
    // Every renderable format is a page, so Prev/Next walks the whole folder rather than stepping over the data files in it.
    let notes = root.join("001-notes.md");
    let manifest = root.join("002-manifest.json");
    let workflow = root.join("003-workflow.yaml");
    fs::write(&notes, "# Notes\n").expect("md page written");
    fs::write(&manifest, "{\"name\": \"x\"}").expect("json page written");
    fs::write(&workflow, "name: x\n").expect("yaml page written");

    // Standing on the JSON page: the Markdown one is behind it, the YAML ahead.
    let html = pager_html(&manifest);
    fs::remove_dir_all(&root).expect("tree removed");

    assert!(
        html.contains("001 Notes") && html.contains("003 Workflow"),
        "a JSON page should sit between its neighbors: {html}"
    );
}

#[test]
fn pager_orders_by_folder_tree_like_the_web_viewer() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-pager-{unique}"));
    let book = root.join("book-1-words-of-the-buddha--kangyur");
    let section = book.join("discipline--vinayavastu");
    let chapter = section.join("chapter-1-going-forth--pravrajyavastu");
    fs::create_dir_all(&chapter).expect("tree is created");
    for dir in [&root, &book, &section, &chapter] {
        fs::write(dir.join("README.md"), "# x\n").expect("README written");
    }
    fs::write(root.join("GLOSSARY.md"), "# Glossary\n").expect("glossary written");

    // Standing on the section README, prev is its parent book and next is its child chapter — the same neighbors the web pager shows.
    let html = pager_html(&section.join("README.md"));
    fs::remove_dir_all(&root).expect("tree removed");

    assert!(
        html.contains(r#"class="docs-pager-prev""#)
            && html.contains("Book 1 Words Of The Buddha Kangyur"),
        "prev should link the parent book: {html}"
    );
    assert!(
        html.contains(r#"class="docs-pager-next""#)
            && html.contains("Chapter 1 Going Forth Pravrajyavastu"),
        "next should link the child chapter: {html}"
    );
    // GLOSSARY.md is opened in the sheet, never a sequential page.
    assert!(
        !html.contains("Glossary"),
        "glossary must not be a pager page: {html}"
    );
}

#[test]
fn each_pager_button_carries_the_page_it_opens() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-pager-title-{unique}"));
    fs::create_dir_all(&root).expect("folder is created");
    fs::write(root.join("README.md"), "# Landing\n").expect("README written");
    for name in ["001-ordination.md", "002-rains.md", "003-robes.md"] {
        fs::write(root.join(name), "# x\n").expect("page written");
    }

    // Standing on the middle page: back one and on one, each button saying which page it opens.
    let middle = pager_html(&root.join("002-rains.md"));
    // The landing page is not a sequential entry, so Next from it opens the first page.
    let landing = pager_html(&root.join("README.md"));
    fs::remove_dir_all(&root).expect("folder removed");

    assert_contains(&middle, r#"data-pager-title="001 Ordination""#);
    assert_contains(&middle, r#"data-pager-title="003 Robes""#);
    assert_contains(&landing, r#"data-pager-title="001 Ordination""#);
    // Nothing counts the pages: the reading order climbs through every folder above the one being read, so a total says nothing a reader can use.
    assert!(
        !middle.contains("data-pager-position"),
        "the pager must not number the book: {middle}"
    );
    assert!(
        !landing.contains("docs-pager-prev"),
        "the landing page has nothing before it: {landing}"
    );
}
