//! Notes, and what a window brings back: the saved session, a dirty tab, and the dialog that names a note.

use super::*;

#[test]
fn a_workspace_restores_saved_regular_files_in_order_and_nearest_tab() {
    let dir = scratch_dir("a_workspace_restores_saved_regular_files_in_order_and_nearest_tab");
    let first = dir.join("first.md");
    let second = dir.join("second.md");
    fs::write(&first, "# First").expect("first session file is written");
    fs::write(&second, "# Second").expect("second session file is written");
    let session = Session {
        tabs: vec![
            SessionTab {
                path: first.clone(),
                title: "First title".to_string(),
                code_view: false,
                ..SessionTab::default()
            },
            SessionTab {
                path: dir.join("gone.md"),
                title: "Gone".to_string(),
                code_view: false,
                ..SessionTab::default()
            },
            SessionTab {
                path: second.clone(),
                title: "Second title".to_string(),
                code_view: true,
                ..SessionTab::default()
            },
        ],
        active: Some(1),
    };

    let workspace = Workspace::from_session(&session);

    assert_eq!(
        workspace.tab_summaries(),
        vec![
            TabSummary {
                title: "First title".to_string(),
                path: first.display().to_string(),
                dirty: false,
                undoable: false,
                redoable: false,
                untitled: false,
            },
            TabSummary {
                title: "Second title".to_string(),
                path: second.display().to_string(),
                dirty: false,
                undoable: false,
                redoable: false,
                untitled: false,
            },
        ]
    );
    assert_eq!(workspace.active, Some(1));
    assert!(workspace.tabs[1].code_view);
    assert!(workspace.tabs.iter().all(|tab| tab.rendered.is_none()));
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

/// Type `typed` into the front tab's own buffer. A new note has its buffer from the start, which is what keeps every reader of that tab off a file that does not exist.
fn type_into_front_note(workspace: &mut Workspace, typed: &str) {
    let edit = workspace
        .active_edit_mut()
        .expect("a new note has its buffer from the start");
    let end = edit.text().len();
    edit.replace_range(end, end, typed);
}

/// One new note, typed into, and nothing else open.
fn new_note_workspace(typed: &str) -> Workspace {
    let mut workspace = Workspace::default();
    workspace.open_untitled();
    type_into_front_note(&mut workspace, typed);
    workspace
}

#[test]
fn the_mid_run_session_skips_a_new_note_and_the_close_carries_it() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("guide.md"));
    workspace.open_untitled();
    type_into_front_note(&mut workspace, "Typed into a new note.\n");

    // The mid-run saves carry no words at all, and an entry for a note with no file and no words in it would come back at the next launch as a blank note nobody opened.
    let mid_run = workspace.session();
    assert_eq!(mid_run.tabs.len(), 1);
    assert_eq!(mid_run.tabs[0].path, PathBuf::from("guide.md"));
    assert!(!mid_run.tabs[0].untitled);
    assert_eq!(mid_run.active, None);

    // The close carries it: the name it is wearing, its words, the flag saying there is nothing to reopen, and no baseline.
    let closing = workspace.closing_session();
    assert_eq!(closing.tabs.len(), 2);
    let note = &closing.tabs[1];
    assert!(note.untitled);
    assert_eq!(note.path, PathBuf::from("Untitled.md"));
    assert_eq!(note.title, "Untitled");
    assert_eq!(
        note.unsaved_text.as_deref(),
        Some("Typed into a new note.\n")
    );
    assert_eq!(note.saved_text, None);
    assert_eq!(closing.active, Some(1));
}

#[test]
fn the_mid_run_session_names_the_document_a_tab_followed_a_link_to_with_that_tabs_label() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("guide.md"));
    // What a link click does to a clean tab: the history moves on, and the strip is relabeled for the document now on screen.
    workspace.tabs[0]
        .history
        .record(PathBuf::from("reference.md"));
    workspace.tabs[0].title = "reference".to_string();

    // The identity the same-document test rests on. Mid-run there are no unsaved words to name a document behind the one being read, so the entry is the tab's own path and the tab's own label — the two sides compared are one path and a clone of it.
    let mid_run = workspace.session();
    assert_eq!(mid_run.tabs.len(), 1);
    assert_eq!(mid_run.tabs[0].path, PathBuf::from("reference.md"));
    assert_eq!(mid_run.tabs[0].title, "reference");
    assert!(!mid_run.tabs[0].untitled);
    assert_eq!(mid_run.active, Some(0));
}

#[test]
fn a_tab_needs_no_seed_for_its_own_buffers_document_with_nothing_on_disk() {
    let dir = scratch_dir("a_tab_needs_no_seed_for_its_own_buffers_document_with_nothing_on_disk");
    let path = dir.join("guide.md");
    let mut workspace = Workspace::default();
    workspace.open_path(path.clone());
    workspace.tabs[0].edit_buffer(
        &path,
        SourceText::utf8(
            "# Guide
"
            .to_string(),
        ),
    );

    // What every editing command asks through needs_edit_seed while somebody types: the buffer's path against the front tab's own, byte for byte. Nothing of that name is on disk, so an answer that went there would be answering off a failed read.
    let showing = workspace.tabs[0]
        .history
        .current()
        .cloned()
        .expect("the tab is showing the document it was opened on");
    assert_eq!(showing, path);
    assert!(!workspace.tabs[0].needs_edit_seed(&showing));
    assert!(workspace.tabs[0].has_edit_for(&showing));

    // And a different document in the same tab still has to be read.
    assert!(workspace.tabs[0].needs_edit_seed(&dir.join("reference.md")));
}

#[test]
fn a_new_note_nobody_typed_into_is_not_carried_out_of_the_window() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("guide.md"));
    workspace.open_untitled();

    // No new rule: the close carries a buffer only where it is dirty, and an untitled buffer's baseline is the empty note it opened as.
    let closing = workspace.closing_session();
    assert_eq!(closing.tabs.len(), 1);
    assert_eq!(closing.tabs[0].path, PathBuf::from("guide.md"));
    assert_eq!(closing.active, None);
}

#[test]
fn a_new_note_comes_back_with_its_words_its_name_its_place_and_its_dot() {
    let dir = scratch_dir("a_new_note_comes_back_with_its_words_its_name_its_place_and_its_dot");
    let guide = dir.join("guide.md");
    fs::write(&guide, "# Guide\n").expect("session file is written");
    let mut workspace = Workspace::default();
    workspace.open_path(guide.clone());
    workspace.open_untitled();
    type_into_front_note(&mut workspace, "Typed into a new note.\n");
    let session = workspace.closing_session();

    let restored = Workspace::from_session(&session);

    assert_eq!(
        restored.tab_summaries(),
        vec![
            TabSummary {
                title: "guide".to_string(),
                path: guide.display().to_string(),
                dirty: false,
                undoable: false,
                redoable: false,
                untitled: false,
            },
            TabSummary {
                title: "Untitled".to_string(),
                path: "Untitled.md".to_string(),
                dirty: true,
                undoable: true,
                redoable: false,
                untitled: true,
            },
        ]
    );
    assert_eq!(restored.active, Some(1));
    assert_eq!(
        restored.tabs[1]
            .edit
            .as_ref()
            .expect("the note is put back")
            .text(),
        "Typed into a new note.\n"
    );
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn undo_on_a_restored_note_is_one_step_back_to_the_empty_note() {
    let session = new_note_workspace("Typed into a new note.\n").closing_session();

    let mut restored = Workspace::from_session(&session);
    let edit = restored.tabs[0]
        .edit
        .as_mut()
        .expect("the note is put back");

    // One step, and it is the empty note the reader started with, which is the only state this document was ever in besides the one it is in.
    assert!(edit.can_undo());
    assert!(edit.undo());
    assert_eq!(edit.text(), "");
    assert!(!edit.can_undo());
    assert!(!edit.is_dirty());
}

#[test]
fn a_restored_note_still_has_no_file_so_the_first_save_is_the_one_that_asks() {
    let session = new_note_workspace("Typed into a new note.\n").closing_session();

    let restored = Workspace::from_session(&session);
    let edit = restored.tabs[0]
        .edit
        .as_ref()
        .expect("the note is put back");

    // The flag `name_untitled_document` reads to decide whether a save has to ask where the note goes.
    assert!(edit.untitled);
    assert_eq!(edit.path, PathBuf::from("Untitled.md"));
    assert_eq!(edit.saved_text(), "");
}

#[test]
fn an_entry_with_no_file_is_never_put_back_from_a_file_of_that_name() {
    let dir = scratch_dir("an_entry_with_no_file_is_never_put_back_from_a_file_of_that_name");
    let decoy = dir.join("Untitled.md");
    fs::write(&decoy, "# Somebody else's file\n").expect("the decoy file is written");

    // A name a note wears is a bare relative one, so a path test resolves it against whatever folder the app was started in. Here the entry names a file that really is on disk: the flag is the only thing that decides, so the file is never read and its words never appear.
    let session = Session {
        tabs: vec![SessionTab {
            path: decoy.clone(),
            title: "Untitled".to_string(),
            untitled: true,
            unsaved_text: Some("Typed into a new note.\n".to_string()),
            ..SessionTab::default()
        }],
        active: Some(0),
    };

    let restored = Workspace::from_session(&session);
    let edit = restored.tabs[0]
        .edit
        .as_ref()
        .expect("the note is put back");
    assert!(edit.untitled);
    assert_eq!(edit.text(), "Typed into a new note.\n");
    assert_eq!(edit.saved_text(), "");
    assert_eq!(
        fs::read_to_string(&decoy).expect("the decoy file is still there"),
        "# Somebody else's file\n"
    );
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

/// A note put back from the saved session wearing the name of `path`, which is a file that really is on disk.
///
/// The one way to stand a note on a name that already resolves to a real file: moving the folder the app was started in would move it for every test in the run. The app writes only bare names into that entry, so this one is the test's own — and the comparison it exercises is the same comparison on the same evidence.
fn note_wearing_a_real_files_name(path: &Path) -> Workspace {
    let session = Session {
        tabs: vec![SessionTab {
            path: path.to_path_buf(),
            title: "Untitled".to_string(),
            untitled: true,
            unsaved_text: Some("Typed into a new note.\n".to_string()),
            ..SessionTab::default()
        }],
        active: Some(0),
    };
    Workspace::from_session(&session)
}

#[test]
fn a_file_named_untitled_opens_in_its_own_tab_rather_than_the_note_wearing_that_name() {
    let dir = scratch_dir(
        "a_file_named_untitled_opens_in_its_own_tab_rather_than_the_note_wearing_that_name",
    );
    let readers_file = dir.join("Untitled.md");
    fs::write(&readers_file, "# The reader's own file\n").expect("the reader's file is written");
    let mut workspace = note_wearing_a_real_files_name(&readers_file);

    workspace.open_path(readers_file.clone());

    // The note is showing no file, so it never answers for one: the reader's file opens beside it and is brought forward.
    assert_eq!(workspace.tabs.len(), 2);
    assert_eq!(workspace.active, Some(1));
    assert_eq!(workspace.active_path(), Some(readers_file.as_path()));
    assert!(workspace.tabs[1].edit.is_none());
    assert_eq!(
        workspace.tabs[0]
            .edit
            .as_ref()
            .expect("the note is still there")
            .text(),
        "Typed into a new note.\n"
    );
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn the_pipe_opens_a_file_the_note_at_the_front_is_named_after() {
    let dir = scratch_dir("the_pipe_opens_a_file_the_note_at_the_front_is_named_after");
    let readers_file = dir.join("Untitled.md");
    fs::write(&readers_file, "# The reader's own file\n").expect("the reader's file is written");
    let mut workspace = note_wearing_a_real_files_name(&readers_file);

    // The pipe asks its own copy of the question before it opens anything, so with the note at the front that answer alone decides whether the file ever opens.
    let moved = pipe_bring_to_front(&mut workspace, &readers_file)
        .expect("the file is on disk, so the ask is answerable");

    assert!(moved);
    assert_eq!(workspace.tabs.len(), 2);
    assert_eq!(workspace.active, Some(1));
    assert_eq!(workspace.active_path(), Some(readers_file.as_path()));
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn a_notes_tab_that_followed_a_link_is_still_the_tab_showing_that_document() {
    let mut workspace = Workspace::default();
    workspace.open_untitled();
    type_into_front_note(&mut workspace, "Typed into a new note.\n");
    // What a link click does to the tab: the history moves on and the no-file buffer stays behind it.
    let guide = PathBuf::from("guide.md");
    workspace.tabs[0].history.record(guide.clone());

    workspace.open_path(guide.clone());

    // The skip reads what the tab is showing, never the flag alone, so this tab still answers for the document it followed the link to.
    assert_eq!(workspace.tabs.len(), 1);
    assert_eq!(workspace.active, Some(0));
    assert_eq!(workspace.active_path(), Some(guide.as_path()));
}

#[test]
fn a_change_to_a_file_the_note_is_named_after_is_not_a_change_to_the_note() {
    let dir = scratch_dir("a_change_to_a_file_the_note_is_named_after_is_not_a_change_to_the_note");
    let readers_file = dir.join("Untitled.md");
    fs::write(&readers_file, "# The reader's own file\n").expect("the reader's file is written");
    let workspace = note_wearing_a_real_files_name(&readers_file);

    // The comparison the watcher, the pager and a link click all make, with the change already in hand. What it guards sits inline in the event loop or behind the window, so the fault is proved where the decision is made.
    let is_active_document = workspace
        .active_file()
        .is_some_and(|current| paths_refer_to_same_document(&readers_file, current));

    assert!(!is_active_document);
    // The note still wears the name, so nothing that reads it for the session, the strip or the render changed; the words in it are the ones that were typed.
    assert_eq!(workspace.active_path(), Some(readers_file.as_path()));
    assert_eq!(
        workspace
            .active_edit()
            .expect("the note is still there")
            .text(),
        "Typed into a new note.\n"
    );
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn a_notes_tab_that_followed_a_link_shows_that_document_as_the_file_on_screen() {
    let mut workspace = Workspace::default();
    workspace.open_untitled();
    type_into_front_note(&mut workspace, "Typed into a new note.\n");
    // What a link click does to the tab: the history moves on and the no-file buffer stays behind it.
    let guide = PathBuf::from("guide.md");
    workspace.tabs[0].history.record(guide.clone());

    // The question reads what the tab is showing, never the flag alone, so a change to that document really is a change to what is on screen.
    assert_eq!(workspace.active_file(), Some(guide.as_path()));
}

#[test]
fn closing_with_a_dirty_tab_brings_its_words_and_its_dot_back() {
    let dir = scratch_dir("closing_with_a_dirty_tab_brings_its_words_and_its_dot_back");
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("session file is written");
    let workspace = dirty_tab_workspace(&note, "# Note\n", "\nTyped and never saved.\n");

    // The mid-run saves carry none of it: typing reaches the buffer every fifth of a second, and this file would be rewritten that often.
    assert_eq!(workspace.session().tabs[0].unsaved_text, None);

    let session = workspace.closing_session();
    assert_eq!(
        session.tabs[0].unsaved_text.as_deref(),
        Some("# Note\n\nTyped and never saved.\n")
    );
    assert_eq!(session.tabs[0].saved_text.as_deref(), Some("# Note\n"));

    let restored = Workspace::from_session(&session);
    assert_eq!(
        restored.tabs[0]
            .edit
            .as_ref()
            .expect("the unsaved buffer is put back")
            .text(),
        "# Note\n\nTyped and never saved.\n"
    );
    // The strip's own payload, which is the only thing that can light the dot on a tab the reader is not looking at.
    assert!(restored.tab_summaries()[0].dirty);
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn a_tab_that_followed_a_link_out_of_its_unsaved_words_comes_back_sitting_on_them() {
    let dir = scratch_dir(
        "a_tab_that_followed_a_link_out_of_its_unsaved_words_comes_back_sitting_on_them",
    );
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("session file is written");
    let guide = dir.join("guide.md");
    fs::write(&guide, "# Guide\n").expect("session file is written");
    let mut workspace = dirty_tab_workspace(&note, "# Note\n", "\nTyped and never saved.\n");
    // What a link click does to the tab: the place on the page is stamped, the history moves on, and the buffer stays behind it with the dot out.
    workspace.tabs[0].history.stamp_current(test_anchor(7));
    workspace.tabs[0].history.record(guide.clone());
    workspace.tabs[0].history.stamp_current(test_anchor(31));
    assert!(!workspace.tab_summaries()[0].dirty);

    // The entry names the document the words belong to, because a restored tab has no Back to press — and the place is the one out of the tab's visit to that document, not the page it walked to.
    let session = workspace.closing_session();
    assert_eq!(session.tabs[0].path, note);
    assert_eq!(session.tabs[0].title, "note");
    assert_eq!(session.tabs[0].anchor, Some(test_anchor(7)));

    let restored = Workspace::from_session(&session);
    assert_eq!(
        restored.tab_summaries(),
        vec![TabSummary {
            title: "note".to_string(),
            path: note.display().to_string(),
            dirty: true,
            undoable: true,
            redoable: false,
            untitled: false,
        }]
    );
    assert_eq!(
        restored.tabs[0]
            .edit
            .as_ref()
            .expect("the unsaved buffer is put back")
            .text(),
        "# Note\n\nTyped and never saved.\n"
    );
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn a_note_a_tab_followed_a_link_out_of_comes_back_as_a_note_with_its_words() {
    let mut workspace = Workspace::default();
    workspace.open_untitled();
    type_into_front_note(&mut workspace, "Typed into a new note.\n");
    // What a link click does to the tab: the history moves on and the no-file buffer stays behind it.
    workspace.tabs[0].history.record(PathBuf::from("guide.md"));

    // Carried exactly as a note closed in front of its tab is: its name, its words, the flag saying there is nothing to reopen, and no baseline.
    let session = workspace.closing_session();
    assert_eq!(session.tabs.len(), 1);
    assert!(session.tabs[0].untitled);
    assert_eq!(session.tabs[0].path, PathBuf::from("Untitled.md"));
    assert_eq!(session.tabs[0].title, "Untitled");
    assert_eq!(session.tabs[0].saved_text, None);

    let restored = Workspace::from_session(&session);
    assert_eq!(
        restored.tab_summaries(),
        vec![TabSummary {
            title: "Untitled".to_string(),
            path: "Untitled.md".to_string(),
            dirty: true,
            undoable: true,
            redoable: false,
            untitled: true,
        }]
    );
    assert_eq!(
        restored.tabs[0]
            .edit
            .as_ref()
            .expect("the note is put back")
            .text(),
        "Typed into a new note.\n"
    );
}

#[test]
fn a_tab_showing_a_file_keeps_its_entry_with_a_notes_buffer_behind_it() {
    let mut workspace = Workspace::default();
    workspace.open_untitled();
    let guide = PathBuf::from("guide.md");
    workspace.tabs[0].history.record(guide.clone());

    // The flag says what the entry describes rather than what the buffer is, so this tab reopens on the file it is showing instead of vanishing with the empty note behind it.
    let mid_run = workspace.session();
    assert_eq!(mid_run.tabs.len(), 1);
    assert_eq!(mid_run.tabs[0].path, guide);
    assert!(!mid_run.tabs[0].untitled);

    let closing = workspace.closing_session();
    assert_eq!(closing.tabs.len(), 1);
    assert_eq!(closing.tabs[0].path, guide);
    assert!(!closing.tabs[0].untitled);
}

#[test]
fn a_file_changed_since_the_close_opens_as_the_disk_has_it() {
    let dir = scratch_dir("a_file_changed_since_the_close_opens_as_the_disk_has_it");
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("session file is written");
    let session = dirty_tab_workspace(&note, "# Note\n", "Typed here.\n").closing_session();

    // Somebody else wrote the file between the close and this launch, so the carried pair is dropped rather than spliced over their words.
    fs::write(&note, "# Note\n\nWritten somewhere else.\n").expect("session file is rewritten");

    let restored = Workspace::from_session(&session);
    assert!(restored.tabs[0].edit.is_none());
    assert!(!restored.tab_summaries()[0].dirty);
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn a_file_gone_from_the_disk_brings_its_words_back_as_a_note_wearing_the_name_it_had() {
    let dir = scratch_dir(
        "a_file_gone_from_the_disk_brings_its_words_back_as_a_note_wearing_the_name_it_had",
    );
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("session file is written");
    let session =
        dirty_tab_workspace(&note, "# Note\n", "\nTyped and never saved.\n").closing_session();

    // Deleted, renamed, or on a drive nobody mounted all answer the same way, and in every one the app holds the only copy of what was typed.
    fs::remove_file(&note).expect("the session file is deleted");

    let restored = Workspace::from_session(&session);
    assert_eq!(
        restored.tab_summaries(),
        vec![TabSummary {
            title: "note".to_string(),
            path: note.display().to_string(),
            dirty: true,
            undoable: true,
            redoable: false,
            // Its file has gone, so its words live only in the buffer and Save has to ask where they go.
            untitled: true,
        }]
    );
    let edit = restored.tabs[0].edit.as_ref().expect("the words come back");
    assert_eq!(edit.text(), "# Note\n\nTyped and never saved.\n");
    // No file behind them any more: this is the flag a save reads to ask where the words go rather than write to a path that may now be a different disk.
    assert!(edit.untitled);
    assert_eq!(edit.path, note);
    assert!(restored.active_file().is_none());
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn undo_on_a_gone_files_restored_words_is_one_step_back_to_the_file_as_it_was_last_saved() {
    let dir = scratch_dir(
        "undo_on_a_gone_files_restored_words_is_one_step_back_to_the_file_as_it_was_last_saved",
    );
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("session file is written");
    let session =
        dirty_tab_workspace(&note, "# Note\n", "\nTyped and never saved.\n").closing_session();
    fs::remove_file(&note).expect("the session file is deleted");

    let mut restored = Workspace::from_session(&session);
    let edit = restored.tabs[0].edit.as_mut().expect("the words come back");

    // One step, and it is the file as it was last saved rather than an empty page: that text is the one earlier state this document was ever in, so a habitual press of undo cannot wipe it.
    assert!(edit.can_undo());
    assert!(edit.undo());
    assert_eq!(edit.text(), "# Note\n");
    assert!(!edit.can_undo());
    assert!(!edit.is_dirty());
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn a_saved_tab_carries_no_words_out_of_the_window() {
    let dir = scratch_dir("a_saved_tab_carries_no_words_out_of_the_window");
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("session file is written");

    // Nothing typed, so there is nothing to put back.
    let mut clean = Workspace::default();
    clean.open_path(note.clone());
    assert_eq!(clean.closing_session().tabs[0].unsaved_text, None);

    // And a tab saved after being restored is clean again by the next close: the session is rebuilt whole every time, so there is nothing to clear.
    let session = dirty_tab_workspace(&note, "# Note\n", "Typed here.\n").closing_session();
    let mut restored = Workspace::from_session(&session);
    let edit = restored.tabs[0]
        .edit
        .as_mut()
        .expect("the unsaved buffer is put back");
    fs::write(&note, edit.text()).expect("the restored buffer is saved");
    edit.mark_saved();

    assert_eq!(restored.closing_session().tabs[0].unsaved_text, None);
    assert!(!restored.tab_summaries()[0].dirty);
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn undo_on_a_restored_tab_is_one_step_back_to_the_saved_file() {
    let dir = scratch_dir("undo_on_a_restored_tab_is_one_step_back_to_the_saved_file");
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("session file is written");
    let session = dirty_tab_workspace(&note, "# Note\n", "Typed here.\n").closing_session();

    let mut restored = Workspace::from_session(&session);
    let edit = restored.tabs[0]
        .edit
        .as_mut()
        .expect("the unsaved buffer is put back");

    // Nothing pretends the old undo stack survived. There is exactly one step, and it is the file as it was last saved.
    assert!(edit.can_undo());
    assert!(edit.undo());
    assert_eq!(edit.text(), "# Note\n");
    assert!(!edit.can_undo());
    assert!(!edit.is_dirty());
    fs::remove_dir_all(&dir).expect("session fixture directory is removed");
}

#[test]
fn startup_restores_the_saved_front_tab_unless_a_path_was_given() {
    let anchor = ScrollAnchor {
        section: Some("reading".to_string()),
        block: 3,
        offset_y: -24.0,
    };
    let mut tab = Tab {
        saved_code_scroll: Some(0.42),
        ..Tab::default()
    };
    tab.history.record(PathBuf::from("guide.md"));
    tab.history.stamp_current(anchor.clone());
    let workspace = Workspace {
        tabs: vec![tab],
        active: Some(0),
    };

    match startup_restore_intent(&workspace, false) {
        Some(ScrollIntent::Restore {
            anchor: Some(saved),
            code: Some(code),
        }) => {
            assert_eq!(saved, anchor);
            assert_eq!(code, 0.42);
        }
        _ => panic!("saved tab must restore its saved place"),
    }
    assert!(startup_restore_intent(&workspace, true).is_none());

    let fresh = Workspace {
        tabs: vec![Tab::default()],
        active: Some(0),
    };
    assert!(matches!(
        startup_restore_intent(&fresh, false),
        Some(ScrollIntent::Restore {
            anchor: None,
            code: None,
        })
    ));
}

#[test]
fn saving_a_session_place_updates_only_the_active_tab() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("first.md"));
    workspace.open_path(PathBuf::from("second.md"));
    let anchor = ScrollAnchor {
        section: None,
        block: 4,
        offset_y: 12.0,
    };

    workspace.save_active_position(Some(anchor.clone()), Some(0.25));

    assert_eq!(workspace.tabs[0].history.current_anchor(), None);
    assert_eq!(workspace.tabs[0].saved_code_scroll, None);
    assert_eq!(workspace.tabs[1].history.current_anchor(), Some(anchor));
    assert_eq!(workspace.tabs[1].saved_code_scroll, Some(0.25));
}

/// The one gesture that changes what a tab is: five pieces of state move together, and two of them - the history entry renamed rather than visited, the render dropped with its name - carry a rule that would otherwise go without failing anything.
#[test]
fn naming_a_new_note_gives_it_a_file_a_label_and_the_front_of_recent() {
    let dir = std::env::temp_dir().join(format!("leaf-first-save-{}", std::process::id()));
    let chosen = dir.join("recipe.json");

    let mut workspace = Workspace::default();
    let wearing = workspace.open_untitled();
    workspace
        .active_edit_mut()
        .expect("a new note has a buffer")
        .replace_range(0, 0, "# Typed before it was named\n");
    // Rendered under the name it was wearing, which is the name that is about to stop existing.
    let drawn = "# Typed before it was named\n";
    workspace.tabs[0].rendered = Some(RenderedCache {
        path: wearing.clone(),
        hash: content_hash(drawn),
        record: None,
        package: None,
        document: opened_document_from_source_with_host(drawn, &wearing, &DesktopHost::default()),
    });
    let steps_before = workspace.tabs[0].history.entries.len();

    let mut recent = RecentFiles::default();
    let already = dir.join("older.md");
    recent.record(already.clone());

    let named = name_untitled_in_workspace(&mut workspace, &mut recent, |asking_about| {
        assert_eq!(
            asking_about,
            wearing.as_path(),
            "the dialog opens on the name the note is wearing"
        );
        Some(chosen.clone())
    });

    assert!(matches!(named, SaveReady::Named));
    let edit = workspace.active_edit().expect("the buffer is still there");
    assert_eq!(edit.path, chosen);
    assert!(!edit.untitled, "it has a file now");
    assert_eq!(
        edit.format,
        DocumentFormat::Json,
        "whoever chose where it goes chose what it is"
    );
    assert_eq!(
        edit.text(),
        "# Typed before it was named\n",
        "naming a note does not touch what was typed into it"
    );

    let tab = &workspace.tabs[0];
    assert_eq!(tab.history.current(), Some(&chosen));
    assert_eq!(
        tab.history.entries.len(),
        steps_before,
        "the entry is renamed in place, so Back does not gain a step to a name nothing was ever at"
    );
    assert_eq!(tab.history.back_target(), None);
    assert_eq!(tab.title, "recipe", "the strip shows the new name");
    assert!(
        tab.rendered.is_none(),
        "the cached render was keyed on the old name"
    );

    assert_eq!(
        recent.files,
        vec![chosen, already],
        "the file joins Recent at the front"
    );
}

/// Closing the dialog is an answer of its own, and the note must be exactly where it was left.
#[test]
fn closing_the_name_dialog_leaves_a_new_note_exactly_as_it_was() {
    let mut workspace = Workspace::default();
    let wearing = workspace.open_untitled();
    workspace
        .active_edit_mut()
        .expect("a new note has a buffer")
        .replace_range(0, 0, "# Not going anywhere\n");
    let drawn = "# Not going anywhere\n";
    workspace.tabs[0].rendered = Some(RenderedCache {
        path: wearing.clone(),
        hash: content_hash(drawn),
        record: None,
        package: None,
        document: opened_document_from_source_with_host(drawn, &wearing, &DesktopHost::default()),
    });
    let mut recent = RecentFiles::default();

    let answer = name_untitled_in_workspace(&mut workspace, &mut recent, |_| None);

    assert!(matches!(answer, SaveReady::Canceled));
    let edit = workspace.active_edit().expect("the buffer is still there");
    assert_eq!(edit.path, wearing);
    assert!(edit.untitled, "it still has no file");
    assert_eq!(edit.text(), "# Not going anywhere\n");
    let tab = &workspace.tabs[0];
    assert_eq!(tab.history.current(), Some(&wearing));
    assert_eq!(tab.title, leaftext::tab_title_from_path(&wearing));
    assert!(
        tab.rendered.is_some(),
        "nothing was renamed, so the render still answers"
    );
    assert!(recent.files.is_empty(), "nothing was written to ask about");
}

/// Every save after the first walks straight past the naming, and must never open a dialog to do it.
#[test]
fn a_note_that_already_has_a_file_is_saved_without_being_asked_where() {
    let mut workspace = Workspace::default();
    let note = PathBuf::from("notes/kept.md");
    workspace.open_path(note.clone());
    workspace.tabs[0].edit = Some(EditableDocument::new(
        note.clone(),
        SourceText::utf8("# Kept\n".to_string()),
    ));
    let mut recent = RecentFiles::default();

    let answer = name_untitled_in_workspace(&mut workspace, &mut recent, |_| {
        panic!("a document that already has a file is never asked where it goes")
    });

    assert!(matches!(answer, SaveReady::Ready));
    assert!(recent.files.is_empty());

    // A tab with no buffer at all has nothing to name either, and the ask stays shut.
    let mut unedited = Workspace::default();
    unedited.open_path(note);
    let answer = name_untitled_in_workspace(&mut unedited, &mut recent, |_| {
        panic!("a tab with no buffer is never asked where it goes")
    });
    assert!(matches!(answer, SaveReady::Ready));
}
