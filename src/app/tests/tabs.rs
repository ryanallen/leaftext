//! The tab strip, what closing one lands on, and what a tab keeps rendered.

use super::*;

#[test]
fn move_tab_reorders_and_keeps_active_document_selected() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/a.md"));
    workspace.open_path(PathBuf::from("/docs/b.md"));
    workspace.open_path(PathBuf::from("/docs/c.md"));
    assert_eq!(workspace.active, Some(2));

    // Drag the first tab to the last slot: [b, c, a].
    assert!(workspace.move_tab(0, 2));
    let paths: Vec<String> = workspace
        .tab_summaries()
        .into_iter()
        .map(|tab| tab.path)
        .collect();
    assert_eq!(
        paths,
        vec![
            PathBuf::from("/docs/b.md").display().to_string(),
            PathBuf::from("/docs/c.md").display().to_string(),
            PathBuf::from("/docs/a.md").display().to_string(),
        ]
    );
    // The active document (c) followed its slot from index 2 to index 1.
    assert_eq!(workspace.active, Some(1));

    // Dragging the active tab tracks it to the drop slot.
    assert!(workspace.move_tab(1, 0));
    assert_eq!(workspace.active, Some(0));

    // No-op and out-of-range moves leave the workspace untouched.
    assert!(!workspace.move_tab(0, 0));
    assert!(!workspace.move_tab(1, 9));
    assert_eq!(workspace.active, Some(0));
}

#[test]
fn dragging_a_tab_redraws_the_strip_and_leaves_the_document_alone() {
    // A reorder changes the strip and nothing else, and a full render is not free: it rereads the file, rewrites the recents, and a tab showing source is thrown away and built again at the top of the file with the caret and the editor's undo stack.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/a.md"));
    workspace.open_path(PathBuf::from("/docs/b.md"));

    assert!(
        matches!(move_tab_draw(&mut workspace, 1, 0), TabDraw::Strip),
        "the strip carries everything a reorder changes, and a reorder never changes which document is on screen"
    );
    // The guard that refuses a drag landing where it started, and one naming no tab: neither draws anything.
    assert!(matches!(
        move_tab_draw(&mut workspace, 0, 0),
        TabDraw::Nothing
    ));
    assert!(matches!(
        move_tab_draw(&mut workspace, 1, 9),
        TabDraw::Nothing
    ));
}

#[test]
fn moving_a_favorite_row_needs_more_than_the_strip() {
    // The cheap path a tab drag now takes would stop these two drawing at all: a favorite row exists only on the start screen, which the strip refresh does not draw. The drag that moves a row clears its transform without moving the row, so this render is the only thing that draws the new order.
    let mut favorites = Favorites::default();
    for path in ["/docs/a.md", "/docs/b.md"] {
        favorites.add(Favorite {
            vault_id: None,
            path: PathBuf::from(path),
            kind: FavoriteKind::Document,
        });
    }

    assert!(
        matches!(
            move_favorite_draw(
                &mut favorites,
                Path::new("/docs/b.md"),
                Some(Path::new("/docs/a.md"))
            ),
            TabDraw::Render(_)
        ),
        "the start screen's own render is the only thing that draws a favorite row in its new place"
    );
    assert!(
        matches!(
            repoint_favorite_draw(
                &mut favorites,
                Path::new("/docs/a.md"),
                Path::new("/docs/moved.md"),
                None
            ),
            TabDraw::Render(_)
        ),
        "a favorite row pointed at another file is drawn by the same render"
    );

    // A row that did not move draws nothing at all, the same guard a tab drag landing where it started has.
    assert!(matches!(
        repoint_favorite_draw(
            &mut favorites,
            Path::new("/docs/never-marked.md"),
            Path::new("/docs/moved.md"),
            None
        ),
        TabDraw::Nothing
    ));
}

#[test]
fn closing_a_tab_to_the_right_of_the_one_being_read_changes_only_the_strip() {
    // The whole reported fault: the document on screen did not change, so nothing about it may be drawn again.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/a.md"));
    workspace.open_path(PathBuf::from("/docs/b.md"));
    workspace.open_path(PathBuf::from("/docs/c.md"));
    assert!(workspace.set_active(0));

    assert_eq!(workspace.close_tab(2), TabClose::StripOnly);
    assert_eq!(workspace.active, Some(0));
    assert_eq!(workspace.tabs.len(), 2);
}

#[test]
fn closing_a_tab_to_the_left_of_the_one_being_read_shifts_the_lit_tab_down() {
    // Same answer, and the strip is redrawn against an index that has moved — so the tab lit is still the one being read.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/a.md"));
    workspace.open_path(PathBuf::from("/docs/b.md"));
    workspace.open_path(PathBuf::from("/docs/c.md"));
    assert_eq!(workspace.active, Some(2));

    assert_eq!(workspace.close_tab(0), TabClose::StripOnly);
    assert_eq!(workspace.active, Some(1));
    assert_eq!(
        workspace.active_file(),
        Some(Path::new("/docs/c.md")),
        "the document being read is still the one being read"
    );
}

#[test]
fn closing_the_last_tab_left_leaves_the_home_screen() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/a.md"));

    assert_eq!(workspace.close_tab(0), TabClose::HomeScreen);
    assert_eq!(workspace.active, None);
    assert!(workspace.tabs.is_empty());
}

#[test]
fn closing_the_tab_being_read_reports_that_the_document_on_screen_changed() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/a.md"));
    workspace.open_path(PathBuf::from("/docs/b.md"));
    assert_eq!(workspace.active, Some(1));

    assert_eq!(workspace.close_tab(1), TabClose::ReaderMoved);
    assert_eq!(workspace.active, Some(0));
}

#[test]
fn closing_a_tab_that_is_not_there_closes_nothing() {
    // An index past the end must draw nothing: rendering the active document at the top is the reported fault for a close that never happened.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/a.md"));

    assert_eq!(workspace.close_tab(9), TabClose::Nothing);
    assert_eq!(workspace.active, Some(0));
    assert_eq!(workspace.tabs.len(), 1);
}

#[test]
fn closing_the_tab_being_read_lands_on_the_neighbor_where_it_was_left() {
    // Every Ctrl+W closes the tab being read, so this is the common case rather than a corner.
    let anchor = ScrollAnchor {
        section: Some("halfway".to_string()),
        block: 7,
        offset_y: -12.0,
    };
    let mut neighbor = Tab {
        saved_code_scroll: Some(0.61),
        ..Tab::default()
    };
    neighbor.history.record(PathBuf::from("/docs/a.md"));
    neighbor.history.stamp_current(anchor.clone());
    let mut being_read = Tab::default();
    being_read.history.record(PathBuf::from("/docs/b.md"));
    let mut workspace = Workspace {
        tabs: vec![neighbor, being_read],
        active: Some(1),
    };

    assert_eq!(workspace.close_tab(1), TabClose::ReaderMoved);
    match restore_front_tab_intent(&workspace) {
        Some(ScrollIntent::Restore {
            anchor: Some(saved),
            code: Some(code),
        }) => {
            assert_eq!(saved, anchor);
            assert_eq!(code, 0.61);
        }
        _ => panic!("the neighbor opens where the reader left it"),
    }
}

#[test]
fn the_home_screen_has_no_place_to_be_put_back_to() {
    let workspace = Workspace::default();
    assert!(restore_front_tab_intent(&workspace).is_none());
}

#[test]
fn closing_the_tab_being_read_restores_rather_than_resetting() {
    let anchor = ScrollAnchor {
        section: Some("halfway".to_string()),
        block: 7,
        offset_y: -12.0,
    };
    let mut neighbor = Tab {
        saved_code_scroll: Some(0.61),
        ..Tab::default()
    };
    neighbor.history.record(PathBuf::from("/docs/a.md"));
    neighbor.history.stamp_current(anchor.clone());
    let mut being_read = Tab::default();
    being_read.history.record(PathBuf::from("/docs/b.md"));
    let mut workspace = Workspace {
        tabs: vec![neighbor, being_read],
        active: Some(1),
    };

    match close_tab_draw(&mut workspace, 1) {
        TabDraw::Render(ScrollIntent::Restore {
            anchor: Some(saved),
            code: Some(code),
        }) => {
            assert_eq!(saved, anchor);
            assert_eq!(code, 0.61);
        }
        _ => panic!("the tab coming forward opens where it was left"),
    }

    assert!(
        matches!(
            close_tab_draw(&mut workspace, 0),
            TabDraw::Render(ScrollIntent::Reset)
        ),
        "the home screen still starts from scratch"
    );
}

#[test]
fn closing_a_background_tab_redraws_the_strip_instead_of_the_document() {
    // The answer is only half of it: a render of any intent reads the file off the disk and pushes the whole document back to a page that did not ask for it.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/docs/a.md"));
    workspace.open_path(PathBuf::from("/docs/b.md"));

    assert!(
        matches!(close_tab_draw(&mut workspace, 0), TabDraw::Strip),
        "a tab beside the one being read redraws the strip and nothing else"
    );
    assert!(
        matches!(close_tab_draw(&mut workspace, 9), TabDraw::Nothing),
        "an index that names no tab draws nothing"
    );
}

#[test]
fn the_render_cache_answers_only_for_the_same_file_unchanged() {
    // A switch reuses the last render only for the same file, unchanged.
    let text = "# Same words in two places\n";
    let hash = content_hash(text);
    let path = PathBuf::from("notes/a.md");
    let cache = RenderedCache {
        path: path.clone(),
        hash,
        document: opened_document_from_source_with_host(text, &path, &DesktopHost::default()),
    };

    assert!(cache.answers_for(&path, hash), "same file, unchanged");
    assert!(
        !cache.answers_for(&path, content_hash("# Edited\n")),
        "the file changed on disk, so the old render is out"
    );
    assert!(
        !cache.answers_for(Path::new("notes/b.md"), hash),
        "another file with identical text is still another file"
    );
}

#[test]
fn a_tab_starts_with_nothing_cached_and_keeps_what_it_renders() {
    // The cache lives on the tab, so one tab's render is never another's.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("notes/a.md"));
    workspace.open_path(PathBuf::from("notes/b.md"));

    assert!(
        workspace.tabs.iter().all(|tab| tab.rendered.is_none()),
        "nothing is cached before anything renders"
    );

    let text = "# A\n";
    let path = PathBuf::from("notes/a.md");
    workspace.tabs[0].rendered = Some(RenderedCache {
        path: path.clone(),
        hash: content_hash(text),
        document: opened_document_from_source_with_host(text, &path, &DesktopHost::default()),
    });
    assert!(
        workspace.tabs[1].rendered.is_none(),
        "one tab's render is not another tab's"
    );
}

/// A package is gated on what its own directory says about every member, so a tab switched back to a file nobody has touched answers out of its cache without the package being unpacked — and the same tab re-renders the moment any member's bytes move underneath it. Both sides of the gate ask one function, which is what stops a cache written on one key being read on another.
#[test]
fn a_switch_back_to_an_unedited_package_answers_from_the_cache() {
    let path = scratch_dir("tabs-package").join("report.docx");
    std::fs::write(
        &path,
        one_member_package("word/document.xml", b"<w:document/>"),
    )
    .expect("the package is written");
    let hash = render_hash(&path, None).expect("a package states its own identity");
    let tab = Tab {
        rendered: Some(RenderedCache {
            path: path.clone(),
            hash,
            document: opened_document_from_source_with_host("", &path, &DesktopHost::default()),
        }),
        ..Tab::default()
    };

    assert!(
        page_shows_file(&tab, &path, ""),
        "nothing moved, so the tab's own render still answers for the file"
    );

    std::fs::write(
        &path,
        one_member_package("word/document.xml", b"<w:document />"),
    )
    .expect("the package is written again");
    assert!(
        !page_shows_file(&tab, &path, ""),
        "a member's bytes moved, so the render on the tab is out"
    );
}

/// A tab with a clean buffer for `path` holding `text`./// A tab with a clean buffer for `path` holding `text`.
fn tab_with_buffer(path: &Path, text: &str) -> Tab {
    Tab {
        edit: Some(EditableDocument::new(
            path.to_path_buf(),
            SourceText::utf8(text.to_string()),
        )),
        ..Tab::default()
    }
}

#[test]
fn a_clean_buffer_takes_the_file_and_unsaved_words_are_kept() {
    // What the page is drawn from when the buffer and the file disagree. Ticking one box leaves a tab holding a buffer, and from then on the disk only reaches the page through this.
    let path = PathBuf::from("notes/plan.md");
    let on_disk = "- [x] one\n- [ ] two\n- [ ] three\n";

    let behind = tab_with_buffer(&path, "- [x] one\n- [ ] two\n");
    assert!(
        buffer_must_take_disk(&behind, &path, on_disk),
        "a clean buffer behind the file has to take what the file now holds"
    );

    let mut caught_up = behind;
    caught_up
        .edit
        .as_mut()
        .expect("buffer")
        .adopt_external(SourceText::utf8(on_disk.to_string()));
    assert_eq!(
        caught_up.edit.as_ref().expect("buffer").text(),
        on_disk,
        "and the page is then drawn from the file's own bytes"
    );
    assert!(
        !buffer_must_take_disk(&caught_up, &path, on_disk),
        "a buffer already holding the file is left alone, so nothing re-renders"
    );

    let mut typed_into = tab_with_buffer(&path, "- [x] one\n- [ ] two\n");
    typed_into
        .edit
        .as_mut()
        .expect("buffer")
        .replace_range(0, 0, "# Unsaved\n");
    assert!(
        !buffer_must_take_disk(&typed_into, &path, on_disk),
        "unsaved words are never written over by the disk"
    );

    assert!(
        !buffer_must_take_disk(&Tab::default(), &path, on_disk),
        "a tab with no buffer is left to the render that reads the file itself"
    );
    assert!(
        !buffer_must_take_disk(
            &tab_with_buffer(Path::new("notes/other.md"), "# Other\n"),
            &path,
            on_disk
        ),
        "a buffer belonging to another document is not this document's"
    );

    let mut in_code_view = tab_with_buffer(&path, "- [x] one\n- [ ] two\n");
    in_code_view.code_view = true;
    assert!(
        buffer_must_take_disk(&in_code_view, &path, on_disk),
        "a tab left showing raw source is drawn from the same buffer, so it is answered the same"
    );
}

#[test]
fn a_package_is_not_opened_for_a_reconciliation_that_could_only_refuse_it() {
    // The gate in front of the file read. A package's buffer holds one member and the file is the archive, so reading it costs the whole file and answers nothing.
    for extension in ["docx", "xlsx", "pptx", "odt", "ods", "odp"] {
        let path = PathBuf::from(format!("decks/slides.{extension}"));
        assert!(
            !buffer_is_worth_opening_the_file(&tab_with_buffer(&path, "<w:document />"), &path),
            "a .{extension} is never opened to be handed to the text decoder"
        );
    }

    let note = PathBuf::from("notes/plan.md");
    assert!(
        buffer_is_worth_opening_the_file(&tab_with_buffer(&note, "- [ ] one\n"), &note),
        "a note's buffer and its file are the same text, so the read still happens"
    );
    assert!(
        !buffer_is_worth_opening_the_file(&Tab::default(), &note),
        "a tab with no buffer is left to the render that reads the file itself"
    );
    assert!(
        !buffer_is_worth_opening_the_file(
            &tab_with_buffer(Path::new("notes/other.md"), "# Other\n"),
            &note
        ),
        "a buffer belonging to another document is not this document's"
    );
}

#[test]
fn a_clean_package_buffer_is_reconciled_on_its_identity_rather_than_its_words() {
    // The gate in place of that read. A package's buffer holds one member, so what says the file moved is the identity its own directory states.
    let path = scratch_dir("tabs-package-buffer").join("report.docx");
    let opened = one_member_package("word/document.xml", b"<w:document/>");
    std::fs::write(&path, &opened).expect("the package is written");
    let tab = Tab {
        edit: Some(EditableDocument::over_package(
            path.clone(),
            SourceText::utf8("<w:document/>".to_string()),
            leaftext::PackageBuffer {
                bytes: opened,
                member: "word/document.xml".to_string(),
            },
        )),
        ..Tab::default()
    };

    assert!(
        !package_buffer_must_take_disk(&tab, &path),
        "nothing moved, so the buffer stands and no member is unpacked"
    );

    std::fs::write(
        &path,
        one_member_package("word/document.xml", b"<w:document />"),
    )
    .expect("the package is written again");
    assert!(
        package_buffer_must_take_disk(&tab, &path),
        "a member's bytes moved, so the buffer is behind the file"
    );

    let mut typed_into = tab;
    typed_into
        .edit
        .as_mut()
        .expect("buffer")
        .replace_range(0, 0, "<w:p/>");
    assert!(
        !package_buffer_must_take_disk(&typed_into, &path),
        "unsaved words are never written over by the disk"
    );

    let note = PathBuf::from("notes/plan.md");
    assert!(
        !package_buffer_must_take_disk(&tab_with_buffer(&note, "- [ ] one\n"), &note),
        "a note carries no archive, so this arm is not its own"
    );
}
