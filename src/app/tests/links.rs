//! Where a link goes and what it resolves against.

use super::*;

fn fixture_source_path(relative_path: &str) -> PathBuf {
    std::env::temp_dir()
        .join("leaf-link-fixtures")
        .join(relative_path)
}

fn file_url_for_fixture(relative_path: &str) -> String {
    url::Url::from_file_path(fixture_source_path(relative_path))
        .expect("fixture path has a file URL")
        .to_string()
}

#[test]
fn classifies_link_targets_for_native_opening() {
    assert_eq!(
        classify_link_target("https://example.com"),
        LinkTarget::External("https://example.com".to_string())
    );
    assert_eq!(
        classify_link_target("HTTPS://example.com"),
        LinkTarget::External("HTTPS://example.com".to_string())
    );
    assert_eq!(
        classify_link_target("file:///C:/docs/Guide.md#install"),
        LinkTarget::LocalDocument("file:///C:/docs/Guide.md#install".to_string())
    );
    assert_eq!(
        classify_link_target("file:///C:/docs/Nested%20Guide.MDOWN#heading"),
        LinkTarget::LocalDocument("file:///C:/docs/Nested%20Guide.MDOWN#heading".to_string())
    );
    assert_eq!(
        classify_link_target("../README.md#overview"),
        LinkTarget::LocalDocument("../README.md#overview".to_string())
    );
    // Every format the reading view renders follows in place, not just Markdown.
    for target in [
        "./data/tei.xml",
        "../package.json",
        "./config.yaml",
        "./config.yml",
    ] {
        assert_eq!(
            classify_link_target(target),
            LinkTarget::LocalDocument(target.to_string()),
            "{target} should open in the reading view"
        );
    }
    assert_eq!(
        classify_link_target("file:///C:/docs/logo.png"),
        LinkTarget::LocalFile("file:///C:/docs/logo.png".to_string())
    );
    assert_eq!(
        classify_link_target("./assets/Release%20Notes.pdf"),
        LinkTarget::LocalFile("./assets/Release%20Notes.pdf".to_string())
    );
    // An address another handler reads, which is told apart from a file beside the note by naming a scheme of its own.
    for target in ["obsidian://open?vault=notes", "zotero://select/x"] {
        assert_eq!(
            classify_link_target(target),
            LinkTarget::ForeignScheme(target.to_string()),
            "{target} names a scheme of its own"
        );
    }
    // A Windows drive letter is one character, so it is a path rather than a scheme.
    assert_eq!(
        classify_link_target(r"C:\notes\a.pdf"),
        LinkTarget::LocalFile(r"C:\notes\a.pdf".to_string())
    );
    assert_eq!(classify_link_target("#section"), LinkTarget::AnchorOnly);
    assert_eq!(classify_link_target("./#section"), LinkTarget::AnchorOnly);
    assert_eq!(classify_link_target(".#section"), LinkTarget::AnchorOnly);
}

#[test]
fn a_link_to_a_file_the_app_does_not_read_reaches_the_opener_resolved() {
    // The system opener resolves a relative path against wherever the app was launched from, which is never where the document is — and it reports success either way, so an unresolved path opens nothing and says nothing. This is the path it is handed instead.
    let current = fixture_source_path("guide/chapter/README.md");

    assert_eq!(
        os_open_target("./assets/Release Notes.pdf", &current),
        // Normalized, because the resolver rebuilds the path out of its components and this machine writes them with its own separator.
        Some(
            normalize_path_lexically(fixture_source_path(
                "guide/chapter/assets/Release Notes.pdf"
            ))
            .to_string_lossy()
            .into_owned()
        )
    );
    assert_eq!(
        os_open_target("../../designs/v3-00-map.pdf", &current),
        Some(
            normalize_path_lexically(fixture_source_path("designs/v3-00-map.pdf"))
                .to_string_lossy()
                .into_owned()
        )
    );

    // An address another handler reads goes out spelled the way the author wrote it: joining it onto the note's folder would make a path of something that is not one.
    for href in ["obsidian://open?vault=notes", "zotero://select/x"] {
        assert_eq!(os_open_target(href, &current), Some(href.to_string()));
    }
    assert_eq!(
        os_open_target("https://example.com/a.pdf", &current),
        Some("https://example.com/a.pdf".to_string())
    );

    // Both spellings of a whole path stand on their own rather than being joined onto the note's folder.
    assert_eq!(
        os_open_target(r"C:\notes\a.pdf", &current),
        Some(r"C:\notes\a.pdf".to_string())
    );
    // A path written from the root of the disk stands on its own rather than being hung off the note's folder. Windows reads a rooted path as rooted on the drive the app is running from, which is that platform's own answer for the same path.
    let rooted =
        os_open_target("/Users/reader/a.pdf", &current).expect("a rooted path reaches the opener");
    assert!(rooted.ends_with(
        &normalize_path_lexically(PathBuf::from("/Users/reader/a.pdf"))
            .to_string_lossy()
            .into_owned()
    ));
    assert!(!rooted.contains("leaf-link-fixtures"));

    // A link the app follows itself never reaches the opener.
    assert_eq!(os_open_target("./other.md", &current), None);
    assert_eq!(os_open_target("#section", &current), None);
}

#[test]
fn a_link_naming_a_file_that_is_not_there_is_reported_rather_than_opened() {
    // The Windows opener reports success whether it opened anything or not, so nothing downstream of it can tell the reader the file was never there.
    let dir = scratch_dir("missing-link");
    fs::create_dir_all(dir.join("chapter")).expect("the fixture folder is made");
    let note = dir.join("chapter").join("README.md");
    fs::write(&note, "# Note\n").expect("the note is written");
    let beside = dir.join("chapter").join("beside.pdf");
    fs::write(&beside, "%PDF-1.4\n").expect("the file beside it is written");

    // The file is there, so nothing is reported and the opener is handed its real path.
    assert_eq!(missing_linked_file("./beside.pdf", &note), None);
    assert_eq!(
        os_open_target("./beside.pdf", &note),
        Some(beside.to_string_lossy().into_owned())
    );

    // The file is not, so the reader is told where the app looked.
    assert_eq!(
        missing_linked_file("../designs/v3-00-map.pdf", &note),
        Some(normalize_path_lexically(dir.join("designs/v3-00-map.pdf")))
    );

    // An address another handler reads is never asked about: a handler that is not installed fails the way it always has.
    for href in [
        "obsidian://open?vault=notes",
        "zotero://select/x",
        "https://example.com/gone.pdf",
    ] {
        assert_eq!(missing_linked_file(href, &note), None);
    }
    // And so is a link this app follows itself, which opens a tab rather than reaching the machine.
    assert_eq!(missing_linked_file("./nowhere.md", &note), None);

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn reveal_file_and_copy_path_reach_a_file_the_app_does_not_read() {
    // Both act on the file rather than on where a click sends you, so a saved page or a PDF beside the note carries them — where the line count and the hover preview still only read a file this app renders.
    let current = fixture_source_path("guide/chapter/README.md");

    assert_eq!(
        linked_file_path("./assets/Release Notes.pdf", &current),
        Some(normalize_path_lexically(fixture_source_path(
            "guide/chapter/assets/Release Notes.pdf"
        )))
    );
    assert_eq!(
        linked_file_path("../../designs/v3-00-map.html", &current),
        Some(normalize_path_lexically(fixture_source_path(
            "designs/v3-00-map.html"
        )))
    );
    // A file this app does read keeps its answer.
    assert_eq!(
        linked_file_path("./other.md#top", &current),
        Some(fixture_source_path("guide/chapter/other.md"))
    );
    // And nothing with no file behind it gains one.
    assert_eq!(
        linked_file_path("https://example.com/a.pdf", &current),
        None
    );
    assert_eq!(
        linked_file_path("obsidian://open?vault=notes", &current),
        None
    );
    assert_eq!(linked_file_path("#section", &current), None);

    // The narrower question is unmoved: a file this app cannot render is still not one the preview or the line count may read.
    assert_eq!(
        linked_document_path("./assets/Release Notes.pdf", &current),
        None
    );
}

#[test]
fn only_a_link_with_a_file_behind_it_resolves_to_a_path() {
    // What Reveal file and Copy path act on, and the same test that decides whether a modified click has anywhere to open. A link to a file the app does not read is not one of them.
    let current = fixture_source_path("guide/chapter/README.md");

    assert_eq!(
        linked_document_path("./other.md#top", &current),
        Some(fixture_source_path("guide/chapter/other.md"))
    );

    // A Previous / Next button carries a `file://` address, and Reveal file, Copy path and the line count all resolve it here.
    let neighbor = fixture_source_path("guide/chapter/other.md");
    let neighbor_url =
        url::Url::from_file_path(&neighbor).expect("an absolute path has a file URL");
    assert_eq!(
        linked_document_path(neighbor_url.as_str(), &current),
        Some(neighbor)
    );

    for href in [
        "https://example.com/page.md",
        "mailto:someone@example.com",
        "#section",
        "./assets/Release%20Notes.pdf",
    ] {
        assert_eq!(
            linked_document_path(href, &current),
            None,
            "{href} has no file in this app to point at"
        );
    }
}

#[test]
fn the_file_a_hover_card_is_about_walks_a_glossary_scheme_and_resolves_the_rest() {
    // The card's picture and its line count are two asks about one link, so they ask one function which file it is. The app's own scheme names a term rather than a path, so that file is the walk up to the nearest glossary — which is why a bare `glossary:` link once drew the glossary's opening above no count at all.
    let root = std::env::temp_dir().join(format!("leaf-hover-card-path-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let deep = root.join("features").join("reading");
    fs::create_dir_all(&deep).expect("fixture tree is created");
    let current = deep.join("ticket.md");
    fs::write(&current, "# Ticket").expect("the open document is written");
    let glossary = root.join("GLOSSARY.md");
    fs::write(&glossary, "# Glossary\n\n## Tier\n\nA band.\n").expect("the glossary is written");

    // Nothing after the colon is the whole glossary, and a term is the same file — the card cuts one down to its entry, and the file under both is the one the walk finds.
    for href in ["glossary:", "glossary:tier", "glossary:#tier"] {
        assert_eq!(
            hover_card_document_path(href, &current),
            Some(glossary.clone()),
            "{href} is about the glossary above the open document"
        );
    }

    // Everything else resolves the way it always did, with no walk in the way.
    assert_eq!(
        hover_card_document_path("./other.md#top", &current),
        Some(deep.join("other.md"))
    );
    for href in [
        "https://example.com/page.md",
        "mailto:someone@example.com",
        "#section",
        "./assets/Release%20Notes.pdf",
    ] {
        assert_eq!(
            hover_card_document_path(href, &current),
            None,
            "{href} names no file this card can be about"
        );
    }

    // With no glossary above it there is no file, so the card asks for neither a picture nor a count rather than being told a wrong number.
    let alone_dir =
        std::env::temp_dir().join(format!("leaf-hover-card-alone-{}", std::process::id()));
    let _ = fs::remove_dir_all(&alone_dir);
    fs::create_dir_all(&alone_dir).expect("the glossaryless folder is created");
    let alone = alone_dir.join("alone.md");
    fs::write(&alone, "# Alone").expect("the glossaryless document is written");
    assert_eq!(hover_card_document_path("glossary:", &alone), None);

    fs::remove_dir_all(&root).expect("fixture tree is removed");
    fs::remove_dir_all(&alone_dir).expect("the glossaryless folder is removed");
}

#[test]
fn resolves_local_markdown_links_against_current_document() {
    let current = fixture_source_path("guide/chapter/README.md");

    assert_eq!(
        path_from_local_link("./other.md#top", &current),
        fixture_source_path("guide/chapter/other.md")
    );
    assert_eq!(
        path_from_local_link("../README.md#overview", &current),
        fixture_source_path("guide/README.md")
    );
    assert_eq!(
        path_from_local_link("../Nested%20Guide.md#install", &current),
        fixture_source_path("guide/Nested Guide.md")
    );
    let nested_file_url = file_url_for_fixture("guide/Nested Guide.md");
    assert_eq!(
        path_from_local_link(&format!("{nested_file_url}#top"), &current),
        fixture_source_path("guide/Nested Guide.md")
    );
}

#[test]
fn reads_the_slug_out_of_a_glossary_scheme_link() {
    assert_eq!(
        glossary_scheme_slug("glossary:karma").as_deref(),
        Some("karma")
    );
    // A leading '#' (from a within-sheet jump like `glossary:#karma`) is dropped.
    assert_eq!(
        glossary_scheme_slug("glossary:#karma").as_deref(),
        Some("karma")
    );
    // The scheme name is case-insensitive and the slug is percent-decoded.
    assert_eq!(
        glossary_scheme_slug("GLOSSARY:t%C4%ABrthikas").as_deref(),
        Some("tīrthikas")
    );
    // A bare scheme (the "open full glossary" link) yields an empty slug.
    assert_eq!(glossary_scheme_slug("glossary:").as_deref(), Some(""));
    // Ordinary links are not glossary-scheme links.
    assert_eq!(glossary_scheme_slug("../glossary.md#karma"), None);
    assert_eq!(glossary_scheme_slug("https://example.com"), None);
}

#[test]
fn detects_same_document_paths_after_canonicalization() {
    let dir = scratch_dir("detects_same_document_paths_after_canonicalization");
    let nested = dir.join("nested");
    fs::create_dir_all(&nested).expect("test directory is created");
    let document = nested.join("guide.md");
    fs::write(&document, "# Guide").expect("test document is written");

    let equivalent = nested.join("..").join("nested").join("guide.md");

    assert!(paths_refer_to_same_document(&document, &equivalent));

    fs::remove_file(&document).expect("test document is removed");
    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn extracts_decoded_link_fragments_for_webview_scrolling() {
    assert_eq!(fragment_from_href("#section"), Some("section".to_string()));
    assert_eq!(
        fragment_from_href("file.md#space%20section"),
        Some("space section".to_string())
    );
    assert_eq!(
        fragment_from_href("file:///C:/docs/Nested%20Guide.md#install"),
        Some("install".to_string())
    );
    assert_eq!(fragment_from_href("https://example.com"), None);
    assert_eq!(fragment_from_href("file.md#"), None);
}

#[test]
fn a_link_opened_as_a_new_page_lands_behind_the_one_being_read() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/notes/first.md"));

    workspace.open_path_behind(PathBuf::from("/notes/linked.md"));
    assert_eq!(workspace.tabs.len(), 2, "the strip gained the linked page");
    assert_eq!(
        workspace.active,
        Some(0),
        "the reader stays on the page they were reading"
    );
    assert_eq!(
        workspace.tabs[1].history.current(),
        Some(&PathBuf::from("/notes/linked.md"))
    );

    // One page per document, and no jumping to it either: the gesture said not now.
    workspace.open_path_behind(PathBuf::from("/notes/linked.md"));
    workspace.open_path_behind(PathBuf::from("/notes/first.md"));
    assert_eq!(workspace.tabs.len(), 2);
    assert_eq!(workspace.active, Some(0));

    // Same inheritance as a plain open: opened out of source, it opens in source.
    workspace.tabs[0].code_view = true;
    workspace.open_path_behind(PathBuf::from("/notes/third.md"));
    assert!(workspace.tabs[2].code_view);
}

/// A link from a note to the plain text file beside it opens a tab rather than being handed to the OS. Before `.txt` was a format, clicking one left the app and nothing came back.
#[test]
fn a_link_to_a_text_file_opens_in_the_app() {
    let current = fixture_source_path("guide/chapter/README.md");

    assert!(is_document_link("./notes.txt"));
    assert_eq!(
        linked_document_path("./notes.txt", &current),
        Some(fixture_source_path("guide/chapter/notes.txt"))
    );
    // And it is not the other answer: a link the app follows itself never reaches the machine.
    assert_eq!(missing_linked_file("./notes.txt", &current), None);
}
