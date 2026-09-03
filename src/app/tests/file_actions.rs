//! Renaming, cutting, copying and pasting a file or a folder.

use super::*;

#[test]
fn rename_file_renames_within_the_same_folder() {
    let dir = scratch_dir("rename_file_renames_within_the_same_folder");
    let original = dir.join("before.md");
    std::fs::write(&original, "# Note\n").expect("write");

    let renamed = rename_file(&original, "after.md").expect("rename succeeds");
    assert_eq!(renamed, dir.join("after.md"));
    assert!(!original.exists());
    assert!(renamed.exists());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rename_file_rejects_path_traversal_and_empty_names() {
    let dir = scratch_dir("rename_file_rejects_path_traversal_and_empty_names");
    let original = dir.join("keep.md");
    std::fs::write(&original, "# Keep\n").expect("write");

    // Empty, dot entries, and any path separator are refused so a rename can never move the file or escape its folder.
    for bad in [
        "",
        "   ",
        ".",
        "..",
        "../evil.md",
        "sub/evil.md",
        "sub\\evil.md",
    ] {
        assert!(
            rename_file(&original, bad).is_err(),
            "rename should reject {bad:?}"
        );
    }
    // The original is untouched after every rejected attempt.
    assert!(original.exists());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn renaming_the_open_document_moves_the_tab_with_it() {
    let dir = scratch_dir("renaming_the_open_document_moves_the_tab_with_it");
    let before = dir.join("notes.yaml");
    fs::write(&before, "title: Notes\n").expect("fixture file is written");

    let mut workspace = dirty_tab_workspace(&before, "title: Notes\n", "body: typed\n");
    let steps = workspace.tabs[0].history.entries.len();

    let after = rename_file(&before, "pages.json").expect("rename succeeds");
    assert!(workspace.follow_rename(&before, &after));

    assert_eq!(workspace.active_path(), Some(after.as_path()));
    assert_eq!(workspace.tabs[0].title, "pages");
    // Renamed in place: Back must not gain a step to a name nothing was ever at.
    assert_eq!(workspace.tabs[0].history.entries.len(), steps);
    // Nothing is re-read, so the render cannot answer out of a cache made under the old name.
    assert!(workspace.tabs[0].rendered.is_none());

    let edit = workspace.tabs[0].edit.as_ref().expect("the buffer is kept");
    assert_eq!(edit.path, after);
    // The words are untouched — only the path the buffer wears moved.
    assert_eq!(edit.text(), "title: Notes\nbody: typed\n");
    // The format follows the new name, the same answer reopening the file would give.
    assert_eq!(edit.format, DocumentFormat::Json);

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn renaming_the_open_document_moves_an_earlier_visit_to_it_too() {
    let dir = scratch_dir("renaming_the_open_document_moves_an_earlier_visit_to_it_too");
    let notes = dir.join("notes.md");
    fs::write(&notes, "# Notes\n").expect("fixture file is written");
    let linked = dir.join("linked.md");
    fs::write(&linked, "# Linked\n").expect("fixture file is written");

    let mut workspace = Workspace::default();
    workspace.open_path(notes.clone());
    // Out to the linked document and back in by another link, so the file is the step showing and a step buried under it at once.
    workspace.tabs[0].history.stamp_current(test_anchor(7));
    workspace.tabs[0].history.record(linked.clone());
    workspace.tabs[0].history.record(notes.clone());
    let steps = workspace.tabs[0].history.entries.len();

    let renamed = rename_file(&notes, "pages.md").expect("rename succeeds");
    assert!(workspace.follow_rename(&notes, &renamed));

    // Renamed in place, both of them: Back must not gain a step to a name nothing was ever at.
    assert_eq!(workspace.tabs[0].history.entries.len(), steps);
    assert_eq!(
        workspace.tabs[0]
            .history
            .entries
            .iter()
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>(),
        vec![renamed.clone(), linked.clone(), renamed.clone()]
    );
    // The path alone was written, so the buried step keeps the place the reader was at on it.
    assert_eq!(
        workspace.tabs[0].history.entries[0].anchor,
        Some(test_anchor(7))
    );

    // Two presses of Back land on the file under its new name rather than on a name nothing is at.
    workspace.tabs[0].history.go_back();
    workspace.tabs[0].history.go_back();
    assert_eq!(workspace.tabs[0].history.current(), Some(&renamed));

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn renaming_a_file_a_tab_has_left_moves_its_buried_step_and_nothing_else() {
    let dir = scratch_dir("renaming_a_file_a_tab_has_left_moves_its_buried_step_and_nothing_else");
    let notes = dir.join("notes.md");
    fs::write(&notes, "# Notes\n").expect("fixture file is written");
    let linked = dir.join("linked.md");
    fs::write(&linked, "# Linked\n").expect("fixture file is written");

    // The tab visited the file, followed a link out of it and never came back, so it is neither showing it nor holding its buffer.
    let mut workspace = Workspace::default();
    workspace.open_path(notes.clone());
    workspace.tabs[0].history.record(linked.clone());
    workspace.tabs[0].title = String::from("linked");
    let text = "# Linked\n";
    workspace.tabs[0].rendered = Some(RenderedCache {
        path: linked.clone(),
        hash: content_hash(text),
        record: None,
        package: None,
        document: Rc::new(opened_document_from_source_with_host(
            text,
            &linked,
            &DesktopHost::default(),
        )),
    });

    let renamed = rename_file(&notes, "pages.md").expect("rename succeeds");
    assert!(!workspace.follow_rename(&notes, &renamed));

    assert_eq!(workspace.tabs[0].history.entries[0].path, renamed);
    assert_eq!(workspace.tabs[0].history.current(), Some(&linked));
    // A buried step is not a redraw: the tab keeps its title and the render it is showing.
    assert_eq!(workspace.tabs[0].title, "linked");
    assert!(workspace.tabs[0]
        .rendered
        .as_ref()
        .is_some_and(|cache| cache.answers_for(&linked, content_hash(text))));

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn renaming_a_file_leaves_a_step_naming_another_file_alone() {
    let mut history = DocumentHistory::default();
    history.record(PathBuf::from("one.md"));
    history.stamp_current(test_anchor(4));
    history.record(PathBuf::from("two.md"));
    history.record(PathBuf::from("three.md"));
    // Back onto the first, so the other two are forward steps and the one walk has to reach them.
    history.go_back();
    history.go_back();

    history.rename_visits(Path::new("three.md"), Path::new("renamed.md"));

    assert_eq!(
        history
            .entries
            .iter()
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>(),
        vec![
            PathBuf::from("one.md"),
            PathBuf::from("two.md"),
            PathBuf::from("renamed.md")
        ],
        "only the file that moved is renamed, and a forward step moves with the rest"
    );
    // A step left alone keeps the place it remembers.
    assert_eq!(history.entries[0].anchor, Some(test_anchor(4)));
}

#[test]
fn renaming_a_file_no_tab_holds_changes_no_tab() {
    let dir = scratch_dir("renaming_a_file_no_tab_holds_changes_no_tab");
    let open = dir.join("open.md");
    fs::write(&open, "# Open\n").expect("fixture file is written");
    let other = dir.join("other.md");
    fs::write(&other, "# Other\n").expect("fixture file is written");

    let mut workspace = Workspace::default();
    workspace.open_path(open.clone());

    let renamed = rename_file(&other, "renamed.md").expect("rename succeeds");
    assert!(!workspace.follow_rename(&other, &renamed));

    assert_eq!(workspace.active_path(), Some(open.as_path()));

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn renaming_the_open_document_renders_with_the_place_its_tab_is_holding() {
    // Every other in-place rebuild sends no place, because the page carries one off the editor it is replacing. A rename moves the path that capture is keyed on, so this is the one that has to name a place.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("notes.md"));
    workspace.tabs[0].saved_code_scroll = Some(0.42);

    match followed_rename_intent(&mut workspace, Path::new("notes.md"), Path::new("renamed.md")) {
        Some(ScrollIntent::Preserve { code }) => assert_eq!(
            code,
            Some(0.42),
            "the place comes off the tab, under the name it has just followed"
        ),
        _ => panic!(
            "a followed rename is still an in-place render, so the reading view neither flashes a spinner nor re-anchors"
        ),
    }

    // A file no tab is on moved, so there is nothing to draw again.
    assert!(followed_rename_intent(
        &mut workspace,
        Path::new("elsewhere.md"),
        Path::new("moved.md")
    )
    .is_none());
}

#[test]
fn a_rename_only_answers_with_a_place_for_the_tab_at_the_front() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("front.md"));
    workspace.open_path(PathBuf::from("behind.md"));
    workspace.tabs[0].saved_code_scroll = Some(0.61);
    workspace.tabs[1].saved_code_scroll = Some(0.12);
    assert!(workspace.set_active(0));

    assert_eq!(
        workspace.front_saved_code_scroll_for(Path::new("front.md")),
        Some(0.61)
    );

    // Renaming a file open behind still redraws the front tab, and that tab's own live position is exacter than anything it saved — so it is left to the page.
    assert_eq!(
        workspace.front_saved_code_scroll_for(Path::new("behind.md")),
        None
    );

    // A tab that has never been scrolled in source view holds nothing to give.
    workspace.tabs[0].saved_code_scroll = None;
    assert_eq!(
        workspace.front_saved_code_scroll_for(Path::new("front.md")),
        None
    );
}

#[test]
fn a_cut_file_pasted_into_a_folder_moves_there() {
    let dir = scratch_dir("a_cut_file_pasted_into_a_folder_moves_there");
    let note = dir.join("note.md");
    let folder = dir.join("archive");
    fs::create_dir_all(&folder).expect("destination is created");
    fs::write(&note, "# Note\n").expect("fixture is written");

    let landed = transfer_into_folder(&note, &folder, true).expect("the move succeeds");
    assert_eq!(landed, folder.join("note.md"));
    assert!(!note.exists(), "the original is gone — this was a move");
    assert_eq!(
        fs::read_to_string(&landed).expect("the moved file is readable"),
        "# Note\n"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_pasted_copy_leaves_the_original_where_it_was() {
    let dir = scratch_dir("a_pasted_copy_leaves_the_original_where_it_was");
    let note = dir.join("note.md");
    let folder = dir.join("archive");
    fs::create_dir_all(&folder).expect("destination is created");
    fs::write(&note, "# Note\n").expect("fixture is written");

    let landed = transfer_into_folder(&note, &folder, false).expect("the copy succeeds");
    assert!(note.exists(), "a copy keeps the original");
    assert!(landed.exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_transfer_never_overwrites_what_is_already_there() {
    // The one outcome that would lose someone's work. Refusing is the whole point.
    let dir = scratch_dir("a_transfer_never_overwrites_what_is_already_there");
    let note = dir.join("note.md");
    let folder = dir.join("archive");
    fs::create_dir_all(&folder).expect("destination is created");
    fs::write(&note, "# Mine\n").expect("fixture is written");
    fs::write(folder.join("note.md"), "# Theirs\n").expect("occupant is written");

    let error = transfer_into_folder(&note, &folder, true).expect_err("the move is refused");
    assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
    assert!(
        error.to_string().contains("note.md"),
        "the message should name what collided, got: {error}"
    );
    assert_eq!(
        fs::read_to_string(folder.join("note.md")).expect("the occupant is readable"),
        "# Theirs\n",
        "and the file that was already there is untouched"
    );
    assert!(note.exists(), "as is the one that was refused");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_folder_cannot_be_put_inside_itself() {
    let dir = scratch_dir("a_folder_cannot_be_put_inside_itself");
    let outer = dir.join("outer");
    let inner = outer.join("inner");
    fs::create_dir_all(&inner).expect("fixture tree is created");

    assert!(
        transfer_into_folder(&outer, &inner, true).is_err(),
        "moving a folder into its own child would consume it"
    );
    assert!(inner.exists(), "and the tree is left alone");

    // Pasting something where it already is is a no-op, not an error.
    let note = outer.join("note.md");
    fs::write(&note, "# Note\n").expect("fixture is written");
    assert!(transfer_into_folder(&note, &outer, true).is_ok());
    assert!(note.exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_folder_moves_with_everything_in_it() {
    let dir = scratch_dir("a_folder_moves_with_everything_in_it");
    let source = dir.join("chapter");
    let destination = dir.join("book");
    fs::create_dir_all(&source).expect("source is created");
    fs::create_dir_all(&destination).expect("destination is created");
    fs::write(source.join("one.md"), "# One\n").expect("fixture is written");

    let landed = transfer_into_folder(&source, &destination, true).expect("the move succeeds");
    assert_eq!(landed, destination.join("chapter"));
    assert!(landed.join("one.md").exists(), "contents come along");
    assert!(!source.exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_pictures_own_file_is_resolved_against_the_document_it_is_drawn_in() {
    // The page holds no path for a picture — a right-click row sends the address the render drew it from — so which folder that address stands against is the open document's answer and nobody else's. Lexical, so no folder needs to exist for the seam to be read.
    let docs = PathBuf::from("C:").join("Notes").join("docs");
    let note = docs.join("note.md");
    let picture = docs.join("imgs").join("shot.png");

    assert_eq!(
        file_cmds::picture_file_for(Some(&note), "leaf-image://local/imgs/shot.png"),
        Some(picture.clone()),
    );
    // The stamp every render puts on so a file replaced on disk is not served from the cache names no folder of its own.
    assert_eq!(
        file_cmds::picture_file_for(Some(&note), "leaf-image://local/imgs/shot.png?leaf-epoch=7"),
        Some(picture),
    );
    // With nothing open there is no folder to stand the address against, and a picture served from the web is no file here at all. Both are why the menu draws none of the three file rows over one.
    assert_eq!(
        file_cmds::picture_file_for(None, "leaf-image://local/imgs/shot.png"),
        None,
    );
    assert_eq!(
        file_cmds::picture_file_for(Some(&note), "https://example.com/shot.png"),
        None,
    );
}

#[test]
fn missing_favorites_and_the_delete_offer_are_plain_state_answers() {
    let dir = scratch_dir("missing-favorites-and-delete-offer");
    let present = dir.join("present.md");
    let present_vault = dir.join("vault");
    fs::create_dir_all(&present_vault).expect("the vault is created");
    fs::write(&present, "# Present\n").expect("the note is written");
    let gone = dir.join("gone.md");
    let favorites = Favorites {
        entries: vec![
            Favorite {
                vault_id: None,
                path: present,
                kind: FavoriteKind::Document,
            },
            Favorite {
                vault_id: None,
                path: gone.clone(),
                kind: FavoriteKind::Document,
            },
        ],
    };
    let missing = file_cmds::missing_favorites(
        &favorites,
        [
            (3, present_vault.display().to_string()),
            (7, dir.join("gone-vault").display().to_string()),
        ],
    );
    assert_eq!(missing.paths, vec![gone.display().to_string()]);
    assert_eq!(missing.vaults, vec![7]);

    let original = dir.join("deleted.md");
    let landed = dir.join("trash").join("deleted.md");
    let mut matching = Some((original.clone(), Some(landed.clone())));
    assert_eq!(
        file_cmds::delete_to_restore(&mut matching, &original),
        Some((original.clone(), Some(landed)))
    );
    assert!(matching.is_none());
    let mut stale = Some((original, None));
    assert_eq!(
        file_cmds::delete_to_restore(&mut stale, Path::new("another.md")),
        None
    );
    assert!(stale.is_none());
    let _ = fs::remove_dir_all(&dir);
}
