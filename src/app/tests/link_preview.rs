//! The card a link hover draws, and the cache behind it.

use super::*;

#[test]
fn a_local_link_preview_is_bounded_cached_and_refreshed_after_an_edit() {
    let dir = std::env::temp_dir().join(format!("leaf-link-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let current = dir.join("current.md");
    let target = dir.join("target.md");
    fs::write(&current, "# Current").expect("current document is written");
    // What the bound has to prove now is where it falls, not that it exists: every section a reader can rest on has to arrive for the page to lift it, so a heading past the old bound is in the answer and one past the new one is not.
    fs::write(
        &target,
        format!(
            "# Preview\n\nOpening text.\n\n{}

## Deep section\n\nStill inside the bound.\n\n{}hidden tail",
            "word ".repeat(20_000),
            "word ".repeat(40_000)
        ),
    )
    .expect("target document is written");

    let first = link_preview_html("target.md", &current).expect("local document previews");
    assert!(
        first.contains("Opening text."),
        "the opening renders: {first}"
    );
    assert!(
        first.contains("Still inside the bound."),
        "a section past the old bound is in what the page lifts from"
    );
    assert!(
        !first.contains("hidden tail"),
        "the render still stops at a bound rather than reading whatever it is pointed at"
    );
    assert_eq!(
        link_preview_html("target.md", &current),
        Some(first),
        "an unchanged target reuses its preview"
    );
    assert_eq!(link_preview_html("https://example.com", &current), None);
    assert_eq!(link_preview_html("missing.md", &current), None);

    fs::write(&target, "# Changed\n\nNew opening.").expect("target document is changed");
    let refreshed = link_preview_html("target.md", &current).expect("changed target previews");
    assert!(
        refreshed.contains("New opening."),
        "an edit refreshes the cached render"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn a_glossary_link_previews_the_nearest_glossary_above_the_open_document() {
    let root = std::env::temp_dir().join(format!("leaf-glossary-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let deep = root.join("features").join("reading");
    fs::create_dir_all(&deep).expect("fixture tree is created");
    let current = deep.join("ticket.md");
    fs::write(&current, "# Ticket").expect("the open document is written");
    fs::write(
        root.join("GLOSSARY.md"),
        "# Glossary

## Tier

One of the bands the running order groups its rows into.

## Track

A line of work.
",
    )
    .expect("the glossary is written");

    // The scheme names a term and no file at all, so the file is the walk up from the open document — the same one the press already makes.
    let html = link_preview_html("glossary:tier", &current)
        .expect("a glossary link previews the glossary above the open document");
    assert!(
        html.contains(r#"id="tier""#),
        "the entry the scheme names is in the answer the page lifts from: {html}"
    );
    assert!(
        html.contains("One of the bands"),
        "the entry's own words are in the answer"
    );

    // Nothing at all rather than a wait: the card drops its picture box on an empty answer, and a document with no glossary above it has no entry to draw.
    let alone_dir = std::env::temp_dir().join(format!("leaf-no-glossary-{}", std::process::id()));
    let _ = fs::remove_dir_all(&alone_dir);
    fs::create_dir_all(&alone_dir).expect("the glossaryless folder is created");
    let alone = alone_dir.join("alone.md");
    fs::write(&alone, "# Alone").expect("the glossaryless document is written");
    assert_eq!(
        link_preview_html("glossary:tier", &alone),
        None,
        "a document with no glossary above it previews nothing"
    );

    fs::remove_dir_all(&root).expect("fixture tree is removed");
    fs::remove_dir_all(&alone_dir).expect("the glossaryless folder is removed");
}

#[test]
fn a_link_preview_request_arrives_with_its_hover_token() {
    match serde_json::from_str::<IpcCommand>(
        r#"{"command":"previewLink","href":"./b.md","token":7}"#,
    ) {
        Ok(IpcCommand::PreviewLink { href, token }) => {
            assert_eq!(href, "./b.md");
            assert_eq!(token, 7);
        }
        other => panic!("Link preview did not arrive: {other:?}"),
    }
}

#[test]
fn a_page_that_cannot_be_previewed_is_still_answered() {
    // The card's waiting box is cleared by nothing but an answer, so a page that cannot be rendered goes down the same channel as an empty one. This is the arm's own expression: link_preview_html's None, defaulted, then written as the answer.
    let dir = std::env::temp_dir().join(format!("leaf-missing-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let current = dir.join("current.md");
    fs::write(&current, "# Current").expect("current document is written");

    let html = link_preview_html("gone.md", &current).unwrap_or_default();
    assert_eq!(html, "", "a deleted target renders nothing");
    assert_eq!(
        link_preview_script(9, &html),
        r#"window.leafLinkPreview(9, "");"#,
        "the page is told the preview is empty rather than left waiting"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn a_link_to_a_data_file_previews_what_its_own_renderer_draws() {
    // One row per format, so a sixth has a row to copy. Each asserts the mark only that renderer makes and the absence of the source read as prose, which is what the Markdown renderer left in the card.
    let dir = std::env::temp_dir().join(format!("leaf-format-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let current = dir.join("current.md");
    fs::write(&current, "# Current").expect("current document is written");

    for (name, source, drawn, raw) in [
        (
            "package.json",
            "{\n  \"name\": \"leaftext\",\n  \"version\": \"1.0.0\"\n}\n",
            r#"<dt>Version</dt>"#,
            "\"version\":",
        ),
        (
            "build.yaml",
            "name: build\non: push\n",
            r#"<dt>On</dt>"#,
            "on: push",
        ),
        (
            "feed.xml",
            "<feed><title>Leaftext news</title><entry><name>A release</name></entry></feed>",
            r#"id="entry-a-release""#,
            "<entry>",
        ),
        (
            "saved.eml",
            "From: a@example.com\r\nTo: b@example.com\r\nSubject: Hello there\r\n\r\nBody text.\r\n",
            r#"<dt>From</dt>"#,
            "From: a@example.com",
        ),
    ] {
        let target = dir.join(name);
        fs::write(&target, source).expect("target document is written");
        let html = link_preview_html(name, &current)
            .unwrap_or_else(|| panic!("{name} previews"));
        assert!(
            html.contains(drawn),
            "{name} is drawn by its own renderer, not read as prose: {html}"
        );
        assert!(
            !html.contains(raw),
            "{name} keeps none of its source as text in the card: {html}"
        );
    }

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn a_data_file_opening_with_three_dashes_previews_its_own_opening() {
    // The worst of what the Markdown path did: a settings file wearing another format's metadata box, its own first document taken for somebody else's frontmatter.
    let dir = std::env::temp_dir().join(format!("leaf-dashes-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let current = dir.join("current.md");
    let target = dir.join("workflow.yaml");
    fs::write(&current, "# Current").expect("current document is written");
    fs::write(&target, "---\nname: build\non: push\n---\n").expect("target document is written");

    let html = link_preview_html("workflow.yaml", &current).expect("the workflow previews");
    assert!(
        !html.contains(r#"class="frontmatter""#),
        "the file's own opening is not drawn as another format's metadata: {html}"
    );
    assert!(
        html.contains("<dt>On</dt>"),
        "the opening is drawn as the fields it is: {html}"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn a_data_file_over_the_preview_ceiling_answers_empty() {
    // A tree format is parsed whole or not at all, so the answer above the ceiling is no picture — never a complaint about a file that opens perfectly in a tab.
    let dir = std::env::temp_dir().join(format!("leaf-ceiling-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let current = dir.join("current.md");
    fs::write(&current, "# Current").expect("current document is written");

    let small = dir.join("small.json");
    fs::write(&small, "{\n  \"name\": \"leaftext\"\n}\n").expect("small document is written");
    assert!(
        link_preview_html("small.json", &current).is_some(),
        "a data file under the ceiling still draws"
    );

    let huge = dir.join("huge.json");
    fs::write(
        &huge,
        format!("{{\n  \"pad\": \"{}\"\n}}\n", "a".repeat(1024 * 1024 + 1)),
    )
    .expect("oversize document is written");
    assert_eq!(
        link_preview_html("huge.json", &current),
        None,
        "a data file over the ceiling answers empty rather than a picture"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn a_link_preview_carries_no_pager_waiting_strip() {
    // A waiting state is a promise. The card walks no folder, so a Previous/Next skeleton in it would pulse for the life of the card for a load nobody started.
    let dir = std::env::temp_dir().join(format!("leaf-pager-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let current = dir.join("current.md");
    fs::write(&current, "# Current").expect("current document is written");
    fs::write(dir.join("note.md"), "# Note\n\nWords.\n").expect("note is written");
    fs::write(dir.join("data.json"), "{\n  \"name\": \"leaftext\"\n}\n")
        .expect("data document is written");

    for name in ["note.md", "data.json"] {
        let html = link_preview_html(name, &current).unwrap_or_else(|| panic!("{name} previews"));
        assert!(
            !html.contains("docs-pager"),
            "{name} draws no Previous/Next strip in the card: {html}"
        );
    }

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn the_link_preview_cache_drops_the_file_held_longest_once_it_is_full() {
    // An entry is a render of a whole file now, so nothing is held for the life of the session. Reading it back off the store rather than through a hover, because two renders of one unchanged file are the same bytes and a hover cannot tell a fresh one from a kept one.
    let mut cache = LinkPreviewCache::default();
    let render = |name: &str| LinkPreviewRender {
        modified: std::time::SystemTime::UNIX_EPOCH,
        html: format!("<p>{name}</p>"),
    };
    for index in 0..LINK_PREVIEW_CACHE_ENTRIES {
        cache.keep(PathBuf::from(format!("note-{index}.md")), render("first"));
    }
    // Resting on the first file again holds its place: what is replaced is a stale copy of the same document, not another file.
    cache.keep(PathBuf::from("note-0.md"), render("again"));
    assert_eq!(
        cache.renders.len(),
        LINK_PREVIEW_CACHE_ENTRIES,
        "a file already held was counted as a new one"
    );

    cache.keep(PathBuf::from("newest.md"), render("newest"));
    assert_eq!(
        cache.renders.len(),
        LINK_PREVIEW_CACHE_ENTRIES,
        "the cache grew past what it is allowed to hold"
    );
    assert!(
        !cache.renders.contains_key(&PathBuf::from("note-0.md")),
        "the file held longest is still here, so nothing was dropped"
    );
    assert!(
        cache.renders.contains_key(&PathBuf::from("newest.md")),
        "the file just rested on was not kept"
    );
    assert!(
        cache.renders.contains_key(&PathBuf::from("note-1.md")),
        "a file dropped that was not the one held longest"
    );
}

#[test]
fn a_link_naming_a_heading_deep_in_a_file_is_answered_with_that_section_and_its_table() {
    // The link the owner rested on: a section four fifths of the way down a long page, whose whole content is a table of steps. The lift is the page's, so what the host owes is the section and its rows in the answer at all — the front-end check drives the lift itself.
    let dir = std::env::temp_dir().join(format!("leaf-deep-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let current = dir.join("current.md");
    let target = dir.join("tracks.md");
    fs::write(&current, "# Current").expect("current document is written");
    fs::write(
        &target,
        format!(
            "# Tracks\n\nThe opening.\n\n{}

## Layer order\n\nWhy it is here.\n\n| Step | What |\n| --- | --- |\n| 1 | The first step |\n| 2 | The second step |\n",
            "word ".repeat(20_000)
        ),
    )
    .expect("target document is written");

    let html = link_preview_html("tracks.md#layer-order", &current)
        .expect("a link carrying a fragment previews the file it names");
    assert!(
        html.contains(r#"id="layer-order""#),
        "the section the address names is in the answer the page lifts from"
    );
    assert!(
        html.contains("The second step"),
        "the table under that heading is in the answer, rows and all"
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}
