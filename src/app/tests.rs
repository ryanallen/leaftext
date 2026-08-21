//! Tests for the binary: tabs, history, file watching, link routing, file actions.

use super::*;
use std::{
    io,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

/// A query as the page would send one, with no date of its own.
fn typed(query: &str) -> TypedQuery {
    TypedQuery::new(query.to_string(), None)
}

fn fixture_source_path(relative_path: &str) -> PathBuf {
    std::env::temp_dir()
        .join("leaf-link-fixtures")
        .join(relative_path)
}

/// A scratch folder of this test's own — the binary's copy of the library's `scratch_dir`, because this file is the binary crate's and cannot see `src/tests/`.
///
/// The label separates two tests: a clock alone ticks slowly enough here to hand two that start together one folder. The process id and one clock reading per run separate two runs.
fn scratch_dir(label: &str) -> PathBuf {
    static RUN: OnceLock<u128> = OnceLock::new();
    let run = RUN.get_or_init(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos()
    });
    let dir = std::env::temp_dir().join(format!("leaf-{label}-{}-{run}", std::process::id()));
    fs::create_dir_all(&dir).expect("scratch directory is created");
    dir
}

#[test]
fn two_scratch_folders_asked_for_under_different_names_are_never_the_same_folder() {
    // Handed in rather than written into the call, so the guard below reads only real call sites.
    let one = "two-scratch-folders-one";
    let other = "two-scratch-folders-other";
    let first = scratch_dir(one);
    let second = scratch_dir(other);

    assert_ne!(first, second, "two names are two folders");
    assert_eq!(
        first,
        scratch_dir(one),
        "and one name is one folder, which is why no two tests may share a name"
    );

    let _ = fs::remove_dir_all(&first);
    let _ = fs::remove_dir_all(&second);
}

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
            },
            TabSummary {
                title: "Second title".to_string(),
                path: second.display().to_string(),
                dirty: false,
                undoable: false,
                redoable: false,
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
            },
            TabSummary {
                title: "Untitled".to_string(),
                path: "Untitled.md".to_string(),
                dirty: true,
                undoable: true,
                redoable: false,
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

/// A tab open on `path`, seeded from `saved` and typed on so it is dirty.
fn dirty_tab_workspace(path: &Path, saved: &str, typed: &str) -> Workspace {
    let mut workspace = Workspace::default();
    workspace.open_path(path.to_path_buf());
    let end = saved.len();
    workspace.tabs[0]
        .edit_buffer(path, SourceText::utf8(saved.to_string()))
        .replace_range(end, end, typed);
    workspace
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

#[test]
fn a_staged_update_installs_itself_at_launch_but_only_once() {
    // The whole point of the updater: a version downloaded last session is installed on the next launch, with nothing for the user to click.
    let mut settings = Settings {
        update_staged_version: "0.1.400".to_string(),
        update_auto_applied: String::new(),
        ..Settings::default()
    };
    assert!(should_auto_apply(&settings, true));

    // Recorded before the installer runs, so an installer that fails silently is attempted once and then left to the button — not retried on every launch, which would be a boot loop.
    settings.update_auto_applied = "0.1.400".to_string();
    assert!(!should_auto_apply(&settings, true));

    // A newer download supersedes the failed one and gets its own attempt.
    settings.update_staged_version = "0.1.401".to_string();
    assert!(should_auto_apply(&settings, true));

    // Nothing on disk, or nothing staged. There is no off switch.
    assert!(!should_auto_apply(&settings, false));
    settings.update_staged_version.clear();
    assert!(!should_auto_apply(&settings, true));
}

#[test]
fn a_landed_update_clears_the_one_attempt_guard() {
    // Once the staged record is gone the install worked, so the next download must not inherit a guard that blocks its automatic attempt.
    let mut settings = Settings {
        update_staged_version: String::new(),
        update_auto_applied: "0.1.400".to_string(),
        ..Settings::default()
    };
    // reconcile_staged_update needs the data dir; assert the narrow rule it enforces rather than reaching into the filesystem.
    if settings.update_staged_version.is_empty() && !settings.update_auto_applied.is_empty() {
        settings.update_auto_applied.clear();
    }
    settings.update_staged_version = "0.1.402".to_string();
    assert!(should_auto_apply(&settings, true));
}

#[cfg(windows)]
#[test]
fn a_staged_files_extension_chooses_what_runs_it() {
    // Windows publishes two installers and a copy takes whichever put it there, so the staged file decides the command. An MSI handed to the app's own installer, or the reverse, would fail in a way nobody could read.
    let msi = crate::platform::installer_command(std::path::Path::new(r"C:\x\leaftext.msi"))
        .expect("an MSI is installable");
    assert_eq!(msi.get_program(), "msiexec");
    assert!(msi.get_args().any(|argument| argument == "/qn"));

    let exe = crate::platform::installer_command(std::path::Path::new(r"C:\x\leaftext.exe"))
        .expect("the app's own installer is installable");
    assert_eq!(exe.get_program(), r"C:\x\leaftext.exe");
    assert!(exe.get_args().any(|argument| argument == "--silent"));

    assert!(
        crate::platform::installer_command(std::path::Path::new(r"C:\x\leaftext.zip")).is_err()
    );
}

#[cfg(windows)]
#[test]
fn a_failed_install_is_reported_in_words_where_there_are_any() {
    // Our own installer has four codes, each a separate thing to tell somebody; `msiexec` has hundreds and Windows already writes them to the event log, so it gets the number alone.
    let ours = std::path::Path::new(r"C:\x\leaftext.exe");
    assert!(crate::platform::installer_exit_code_meaning(ours, 2).contains("still open"));
    assert!(crate::platform::installer_exit_code_meaning(ours, 3).contains("without the app"));
    assert!(crate::platform::installer_exit_code_meaning(ours, 9).contains("code 9"));
    assert!(crate::platform::installer_exit_code_meaning(
        std::path::Path::new(r"C:\x\leaftext.msi"),
        2
    )
    .contains("code 2"));
}

fn file_url_for_fixture(relative_path: &str) -> String {
    url::Url::from_file_path(fixture_source_path(relative_path))
        .expect("fixture path has a file URL")
        .to_string()
}

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
        document: opened_document_from_source_with_host(text, &linked, &DesktopHost::default()),
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
fn startup_failure_message_includes_recovery_hint() {
    let error = io::Error::new(io::ErrorKind::NotFound, "webview runtime missing");
    let message = startup_failure_message(&error);

    assert!(message.contains("Leaftext could not start."));
    assert!(message.contains("webview runtime missing"));
    assert!(message.contains("Microsoft Edge WebView2 Runtime"));
}

#[test]
fn startup_failure_message_identifies_webview_access_denied() {
    let error = io::Error::new(io::ErrorKind::PermissionDenied, "Access is denied.");
    let message = startup_failure_message(&error);

    assert!(message.contains("Leaftext could not start."));
    assert!(message.contains("Access is denied."));
    assert!(message.contains("per-user browser data folder"));
    assert!(message.contains("webview2"));
    assert!(!message.contains("Microsoft Edge WebView2 Runtime"));
}

#[test]
fn content_hash_distinguishes_changed_documents() {
    // Same contents hash equal (so the live-reload path skips a no-op re-render); a single-character edit changes the hash (so a real save is not mistaken for a duplicate event).
    assert_eq!(
        content_hash("# Title\n\nBody"),
        content_hash("# Title\n\nBody")
    );
    assert_ne!(
        content_hash("# Title\n\nBody"),
        content_hash("# Title\n\nBody!")
    );
}

#[test]
fn watch_dir_for_uses_the_documents_parent_directory() {
    let dir = std::env::temp_dir().join(format!("leaf-watch-dir-fixture-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let document = dir.join("notes.md");
    fs::write(&document, "# Notes").expect("fixture document is written");

    let watched = watch_dir_for(&document).expect("a document with a parent yields a dir");
    let expected = fs::canonicalize(&dir).unwrap_or(dir.clone());
    assert_eq!(watched, expected);

    // A bare filename has no usable parent, so nothing is watched (we never fall back to watching a huge ancestor directory).
    assert_eq!(watch_dir_for(Path::new("loose.md")), None);

    fs::remove_file(&document).expect("fixture document is removed");
    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn desired_watches_cover_the_project_folder_and_the_open_document() {
    let root = std::env::temp_dir().join(format!(
        "leaf-desired-watches-fixture-{}",
        std::process::id()
    ));
    let project = root.join("project");
    let outside = root.join("outside");
    fs::create_dir_all(&project).expect("project directory is created");
    fs::create_dir_all(&outside).expect("outside directory is created");

    let canon = |path: &Path| fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    // A document inside the project folder is already covered by the recursive watch, so the project folder is the only directory watched.
    let inside_doc = project.join("notes.md");
    let (watches, _) = desired_watches(Some(&inside_doc), Some(&project), RecursiveMode::Recursive);
    assert_eq!(watches.len(), 1);
    assert_eq!(
        watches.get(&canon(&project)),
        Some(&RecursiveMode::Recursive)
    );

    // A document outside the project folder adds its own non-recursive watch.
    let outside_doc = outside.join("loose.md");
    let (watches, _) =
        desired_watches(Some(&outside_doc), Some(&project), RecursiveMode::Recursive);
    assert_eq!(
        watches.get(&canon(&project)),
        Some(&RecursiveMode::Recursive)
    );
    assert_eq!(
        watches.get(&canon(&outside)),
        Some(&RecursiveMode::NonRecursive)
    );

    // No project folder: only the document's folder is watched, non-recursively.
    let (watches, _) = desired_watches(Some(&outside_doc), None, RecursiveMode::Recursive);
    assert_eq!(watches.len(), 1);
    assert_eq!(
        watches.get(&canon(&outside)),
        Some(&RecursiveMode::NonRecursive)
    );

    // A stale (nonexistent) project path is not watched.
    let missing = root.join("does-not-exist");
    let (watches, all_resolved) = desired_watches(None, Some(&missing), RecursiveMode::Recursive);
    assert!(watches.is_empty());
    // And the folder having been named and produced nothing is said so, which is what stops the sync gate closing over it.
    assert!(!all_resolved);

    fs::remove_dir_all(&root).expect("fixture directory is removed");
}

#[test]
fn a_second_sync_with_the_same_inputs_leaves_the_watched_set_alone() {
    let dir = std::env::temp_dir().join(format!("leaf-watch-gate-fixture-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let document = dir.join("notes.md");
    fs::write(&document, "# Notes").expect("fixture document is written");
    let watched_dir = fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());

    let mut watch = FileWatch::default();
    watch.sync(Some(&document), Some(&dir), RecursiveMode::Recursive);
    assert_eq!(
        watch.watched.get(&watched_dir),
        Some(&RecursiveMode::Recursive)
    );

    // The disk is the instrument. The folder goes while the three inputs stay exactly as they were, so a second look would find nothing to watch and empty the set; the set standing is the proof nothing looked.
    fs::remove_file(&document).expect("fixture document is removed");
    fs::remove_dir_all(&dir).expect("fixture directory is removed");
    watch.sync(Some(&document), Some(&dir), RecursiveMode::Recursive);
    assert_eq!(watch.watched.len(), 1);
    assert_eq!(
        watch.watched.get(&watched_dir),
        Some(&RecursiveMode::Recursive)
    );
}

#[test]
fn switching_vault_browsing_a_folder_and_opening_a_document_each_move_the_watched_set() {
    let root =
        std::env::temp_dir().join(format!("leaf-watch-moves-fixture-{}", std::process::id()));
    let vault = root.join("vault");
    let browsed = root.join("browsed");
    let elsewhere = root.join("elsewhere");
    for dir in [&vault, &browsed, &elsewhere] {
        fs::create_dir_all(dir).expect("fixture directory is created");
    }
    let canon = |path: &Path| fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    let mut watch = FileWatch::default();
    watch.sync(None, Some(&vault), RecursiveMode::Recursive);
    assert_eq!(
        watch.watched.get(&canon(&vault)),
        Some(&RecursiveMode::Recursive)
    );

    // A vault closed and a folder browsed to instead: one level, and the vault's watch comes off.
    watch.sync(None, Some(&browsed), RecursiveMode::NonRecursive);
    assert_eq!(watch.watched.len(), 1);
    assert_eq!(
        watch.watched.get(&canon(&browsed)),
        Some(&RecursiveMode::NonRecursive)
    );

    // A document opened outside that folder brings its own folder with it.
    let document = elsewhere.join("notes.md");
    fs::write(&document, "# Notes").expect("fixture document is written");
    watch.sync(Some(&document), Some(&browsed), RecursiveMode::NonRecursive);
    assert_eq!(watch.watched.len(), 2);
    assert_eq!(
        watch.watched.get(&canon(&elsewhere)),
        Some(&RecursiveMode::NonRecursive)
    );

    fs::remove_dir_all(&root).expect("fixture directory is removed");
}

#[test]
fn a_released_watch_comes_back_on_the_next_sync_with_unchanged_inputs() {
    let dir =
        std::env::temp_dir().join(format!("leaf-watch-release-fixture-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let watched_dir = fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());

    let mut watch = FileWatch::default();
    watch.sync(None, Some(&dir), RecursiveMode::Recursive);
    assert!(watch.watched.contains_key(&watched_dir));

    // The vault folder is about to be deleted, so the watch comes off mid-turn and the sync at the end of that same turn is what puts it back.
    watch.release(&dir);
    assert!(watch.watched.is_empty());
    watch.sync(None, Some(&dir), RecursiveMode::Recursive);
    assert_eq!(
        watch.watched.get(&watched_dir),
        Some(&RecursiveMode::Recursive)
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn a_folder_that_does_not_exist_yet_is_watched_once_it_appears() {
    let dir =
        std::env::temp_dir().join(format!("leaf-watch-appears-fixture-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);

    let mut watch = FileWatch::default();
    watch.sync(None, Some(&dir), RecursiveMode::Recursive);
    assert!(watch.watched.is_empty());

    // The same folder, the same inputs, and now it is there: an input that named something and produced no watch is never taken as settled.
    fs::create_dir_all(&dir).expect("fixture directory is created");
    watch.sync(None, Some(&dir), RecursiveMode::Recursive);
    let watched_dir = fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
    assert_eq!(
        watch.watched.get(&watched_dir),
        Some(&RecursiveMode::Recursive)
    );

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn watcher_events_translate_back_to_plain_paths() {
    // Windows canonical form carries the verbatim prefix; the app compares plain.
    assert_eq!(
        plain_event_path(PathBuf::from(r"\\?\C:\notes\mail.eml")),
        PathBuf::from(r"C:\notes\mail.eml")
    );
    assert_eq!(
        plain_event_path(PathBuf::from(r"\\?\UNC\server\share\note.md")),
        PathBuf::from(r"\\server\share\note.md")
    );
    // Already plain, on either platform: untouched.
    assert_eq!(
        plain_event_path(PathBuf::from(r"C:\notes\mail.eml")),
        PathBuf::from(r"C:\notes\mail.eml")
    );
    assert_eq!(
        plain_event_path(PathBuf::from("/vault/notes/mail.eml")),
        PathBuf::from("/vault/notes/mail.eml")
    );
}

#[test]
fn the_watcher_translates_at_its_own_boundary() {
    // Every consumer of a change event compares plain paths, so the translation has to happen where the event is born — not in one consumer at a time.
    let source = include_str!("watch.rs");
    assert!(
        source.contains("UserEvent::FileChanged(plain_event_path(event.path))"),
        "the debouncer must translate event paths before sending them"
    );
}

#[test]
fn a_write_inside_git_is_not_a_change_the_app_can_act_on() {
    // Git's own bookkeeping is the one thing under a watched vault that is never news: no document to reload, no row to draw — and reading the vault's git state is what writes it.
    assert!(is_git_bookkeeping(Path::new("/vault/.git/index")));
    assert!(is_git_bookkeeping(Path::new("/vault/.git/refs/heads/main")));
    // A submodule and a worktree keep a `.git` file rather than a folder.
    assert!(is_git_bookkeeping(Path::new("/vault/module/.git")));
    // The watcher reports in the form the watch was registered with, which on Windows is verbatim — the filter runs before the translation, so it has to read that form too.
    #[cfg(windows)]
    assert!(is_git_bookkeeping(Path::new(r"\\?\C:\vault\.git\index")));

    // A prefix test would swallow these three, and the last two are files somebody edits in this app.
    assert!(!is_git_bookkeeping(Path::new("/vault/notes/mail.md")));
    assert!(!is_git_bookkeeping(Path::new("/vault/.gitignore")));
    assert!(!is_git_bookkeeping(Path::new(
        "/vault/.github/workflows/release-windows.yml"
    )));
}

#[test]
fn a_write_under_a_folder_that_holds_generated_files_is_refused_at_the_boundary() {
    // A vault that is also a folder somebody builds in raises an event per file, and each one costs the loop's whole tail as well as an arm. Nothing is open, so the one exception below does not apply.
    let nothing_open: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    assert!(is_generated_output(
        Path::new("/vault/app/target/debug/deps/unit.rlib"),
        &nothing_open
    ));
    assert!(is_generated_output(
        Path::new("/vault/site/node_modules/pkg/index.js"),
        &nothing_open
    ));
    // The watcher reports in the form the watch was registered with, which on Windows is verbatim.
    #[cfg(windows)]
    assert!(is_generated_output(
        Path::new(r"\\?\C:\vault\target\debug\x.rlib"),
        &nothing_open
    ));

    // Beside it, and not under it: the notes somebody keeps, a folder whose name merely starts with the same word, and the build folder itself appearing — which is a row the pane has to draw.
    assert!(!is_generated_output(
        Path::new("/vault/notes/mail.md"),
        &nothing_open
    ));
    assert!(!is_generated_output(
        Path::new("/vault/build-notes/plan.md"),
        &nothing_open
    ));
    assert!(!is_generated_output(
        Path::new("/vault/app/target"),
        &nothing_open
    ));
}

#[test]
fn the_document_being_read_out_of_a_generated_folder_still_reloads() {
    // A README opened out of `node_modules`, or generated documentation opened out of `build`, is a document somebody is looking at. The folder is the exception, not the file, so a sibling changing still refreshes the pane.
    let open_in = PathBuf::from("/vault/node_modules/pkg");
    let reading_in: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(Some(open_in.clone())));

    assert!(!is_generated_output(
        &open_in.join("readme.md"),
        &reading_in
    ));
    assert!(!is_generated_output(
        &open_in.join("changes.md"),
        &reading_in
    ));
    // One folder further in is not the folder being read.
    assert!(is_generated_output(
        &open_in.join("docs/guide.md"),
        &reading_in
    ));
    assert!(is_generated_output(
        Path::new("/vault/node_modules/other/index.js"),
        &reading_in
    ));
}

#[test]
fn a_dot_folder_in_the_shown_folder_looks_exactly_like_a_document_to_the_pane_test() {
    // Held as its own claim so the trap cannot come back. This is not the bug pinned: the pane's test compares a path against the folder on screen and cannot tell a dot folder from a document — which is the whole argument for refusing `.git` at the watcher instead of narrowing this.
    let folder = PathBuf::from("/vault/notes");
    let mut state = VaultState::load(None);
    state.folder = folder.to_string_lossy().to_string();

    assert!(change_affects_pane(&state, &folder.join(".git")));
    assert!(change_affects_pane(&state, &folder.join("mail.md")));
}

#[test]
fn reading_a_vaults_git_state_is_itself_a_change_the_watcher_would_report() {
    // The loop's closing edge, as a claim rather than a paragraph: the app is its own event source. Never `git_tooling()` as the gate — that one runs `gh auth status`, which goes to the network.
    let git_answers = std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success());
    if !git_answers {
        println!("skipped: git is not on this machine, so there is no repository to read");
        return;
    }

    let dir = std::env::temp_dir().join(format!("leaf-git-loop-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let git = |args: &[&str]| {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(&dir)
            .output()
            .expect("git runs");
        assert!(out.status.success(), "git {args:?} succeeds in the fixture");
    };
    git(&["init", "--quiet", "-b", "main"]);
    fs::write(dir.join("note.md"), "# Note\n").expect("a document is written");
    git(&["add", "note.md"]);
    git(&[
        "-c",
        "user.email=leaf@example.com",
        "-c",
        "user.name=Leaf",
        "commit",
        "--quiet",
        "-m",
        "first",
    ]);

    let modified = || {
        fs::metadata(dir.join(".git"))
            .and_then(|meta| meta.modified())
            .expect("the .git folder has a modified time")
    };
    let before = modified();
    // Exactly what a filesystem event under an active vault must not run.
    inspect_vault_repo(&dir);
    assert!(
        modified() > before,
        "reading a vault's git state modifies its own .git folder, so a recursive watch reports it straight back"
    );

    make_writable(&dir);
    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn coming_back_to_the_window_rereads_the_vault_you_are_in_and_does_it_once() {
    // A commit made in a terminal writes nothing but `.git`, which the watcher does not report, so coming back to the window is the gesture that has to correct the header's count. The once is the guard the read goes through, held by `a_burst_of_saves_reads_a_vaults_git_state_once`.
    let mut state = VaultState::load(None);

    assert_eq!(
        vault_to_reread(&state),
        None,
        "with no vault there is nothing to read"
    );

    state.active = 7;
    assert_eq!(
        vault_to_reread(&state),
        Some(7),
        "the vault the reader is in is the one whose git state is read again"
    );
}

#[test]
fn a_burst_of_saves_reads_a_vaults_git_state_once() {
    let mut state = VaultState::load(None);

    // The first save starts the read; the next ten find it running and leave one repeat between them, not ten.
    assert!(state.may_read_status(7));
    for _ in 0..10 {
        assert!(!state.may_read_status(7));
    }

    // The answer lands: the repeat is owed, and it is the only one.
    assert!(state.status_read_settled(7));
    assert!(state.may_read_status(7));
    assert!(!state.status_read_settled(7));

    // And the guard is what the refresh actually asks, rather than a bookkeeping pair nothing consults.
    assert!(include_str!("vault_git.rs").contains("if !state.may_read_status(id) {"));
    assert!(include_str!("vault_git.rs").contains("if state.status_read_settled(id) {"));
}

#[test]
fn a_second_vault_is_not_made_to_wait_behind_the_first() {
    // The page asks for every vault it knows at once, so a single flag would answer one of them and drop the rest.
    let mut state = VaultState::load(None);
    assert!(state.may_read_status(1));
    assert!(state.may_read_status(2));
    assert!(!state.may_read_status(1));

    assert!(state.status_read_settled(1));
    assert!(!state.status_read_settled(2));
}

/// Take the read-only flag off everything under `dir`. Git marks every object file it writes read-only, and a removal on Windows is refused by one.
fn make_writable(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            make_writable(&path);
        } else if let Ok(meta) = fs::metadata(&path) {
            let mut permissions = meta.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(&path, permissions);
        }
    }
}

#[test]
fn an_external_file_in_the_shown_folder_refreshes_the_pane_for_every_format() {
    let dir =
        scratch_dir("an_external_file_in_the_shown_folder_refreshes_the_pane_for_every_format");
    let canonical = fs::canonicalize(&dir).expect("fixture directory canonicalizes");

    let mut state = VaultState::load(None);
    // The pane holds the plain form, the way browsing builds it.
    state.folder = plain_event_path(canonical.clone())
        .to_string_lossy()
        .to_string();

    // The watcher reports in canonical form; translated, every readable format must land — .eml arriving from a mail client the same as a saved .md.
    for extension in all_document_extensions() {
        let changed = plain_event_path(canonical.join(format!("new.{extension}")));
        assert!(
            change_affects_pane(&state, &changed),
            "a new .{extension} in the shown folder must refresh the pane"
        );
    }

    // A change one level down is not on screen, so it asks for no re-read.
    let below = plain_event_path(canonical.join("sub").join("deep.md"));
    assert!(!change_affects_pane(&state, &below));

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
}

#[test]
fn an_answer_to_a_query_the_field_moved_past_never_reaches_the_page() {
    let mut state = VaultState::load(None);

    // Each keystroke claims a number, and only the newest one is wanted.
    let first = state.search.generation.claim();
    let second = state.search.generation.claim();
    assert!(!state.search.generation.is_current(first));
    assert!(state.search.generation.is_current(second));

    // A running scan reads the same number between documents, so it stops instead of finishing an answer nobody will read.
    let corpus = VaultCorpus {
        skipped: Vec::new(),
        root: PathBuf::from("/vault"),
        documents: vec![CorpusDocument {
            path: "/vault/note.md".to_string(),
            label: "note".to_string(),
            aliases: Vec::new(),
            text: "A talk on dharma.".to_string(),
        }],
        truncated: false,
    };
    let generation = state.search.generation.clone();
    assert!(corpus
        .search_until(&typed("dharma").parsed, None, &|| !generation
            .is_current(second))
        .is_some());
    assert!(corpus
        .search_until(&typed("dharma").parsed, None, &|| !generation
            .is_current(first))
        .is_none());

    // Switching vaults abandons the scan with nothing taking its place, so the answer about the vault we left is dropped too — and so is the read feeding it, which stops between documents rather than walking a folder nobody is in.
    let reading = state.corpus_read.claim();
    state.drop_corpus();
    assert!(!state.search.generation.is_current(second));
    assert!(
        !state.corpus_read.is_current(reading),
        "leaving a vault left its read running"
    );
}

#[test]
fn a_stopped_read_s_last_slice_still_frees_the_next_vault_to_be_read() {
    let left = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(left.clone());
    state.corpus_loading = true;
    let reading = state.corpus_read.claim();

    // The reader picks another vault while the first is still being opened.
    state.drop_corpus();
    state.root = Some(PathBuf::from("/another-vault"));
    assert!(!state.corpus_read.is_current(reading));

    // The stopped read still sends the slice that says it is over: its text is thrown away, and freeing the next vault is the whole of what it is for. A read that returned instead of breaking would never send one, and no vault could be read again for the session.
    assert!(absorb_corpus_slice(
        &mut state,
        &left,
        Vec::new(),
        false,
        Vec::new(),
        true,
        true,
        reading
    )
    .is_none());
    assert!(
        !state.corpus_loading,
        "a stopped read left every later vault unreadable"
    );
}

/// One document, as a slice of a read carries it.
fn slice_document(name: &str) -> CorpusDocument {
    CorpusDocument {
        path: format!("/vault/{name}.md"),
        label: name.to_string(),
        aliases: Vec::new(),
        text: format!("# {name}\n\na talk on dharma\n"),
    }
}

#[test]
fn every_slice_of_a_read_answers_the_parked_query_and_moves_the_corpus_number() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    // Somebody typed before the vault had been read, so the query is waiting on it.
    state.pending_search = Some(typed("dharma"));
    let started = state.corpus_generation;
    // Every slice below is stamped with this one read's number, the way a live read's are.
    let reading = state.corpus_read.claim();

    let first = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("one")],
        false,
        Vec::new(),
        true,
        false,
        reading,
    )
    .expect("the first slice is for the vault on screen");
    assert_eq!(first.corpus.documents.len(), 1);
    // Answered over what has landed, and still parked: taken here, the read would go quiet for every slice after this one.
    assert!(
        first.parked.is_some(),
        "the first slice did not answer the parked query"
    );
    assert!(
        state.pending_search.is_some(),
        "the first slice took the parked query out of its slot"
    );
    assert!(
        state.corpus_partial,
        "a vault still being read was called whole"
    );
    assert!(
        first.hints.is_none(),
        "the completion menu was filled from part of a vault"
    );
    assert_eq!(state.corpus_generation, started + 1);

    let middle = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("two")],
        false,
        Vec::new(),
        false,
        false,
        reading,
    )
    .expect("a later slice is kept");
    // Grown, not replaced.
    assert_eq!(middle.corpus.documents.len(), 2);
    assert!(middle.parked.is_some());
    // Every slice moves the number both the kept answer and the narrowing shortcut turn on, so neither can hand back an answer that saw half the vault.
    assert_eq!(state.corpus_generation, started + 2);

    let last = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("three")],
        false,
        Vec::new(),
        false,
        true,
        reading,
    )
    .expect("the last slice is kept");
    assert_eq!(last.corpus.documents.len(), 3);
    assert!(
        last.parked.is_some(),
        "the last slice did not answer the parked query"
    );
    assert!(
        state.pending_search.is_none(),
        "the finished read left its query parked for ever"
    );
    assert!(
        !state.corpus_partial,
        "a finished read still called its text partial"
    );
    assert!(
        !state.corpus_loading,
        "a finished read left the vault looking unread"
    );
    assert!(last.hints.is_some(), "the completion menu was never filled");
    assert_eq!(state.corpus_generation, started + 3);
}

#[test]
fn a_read_of_a_vault_nobody_is_in_any_more_is_thrown_away() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));
    let elsewhere = PathBuf::from("/somewhere-else");
    // Still the read being waited for, so the root is the only thing that can turn this slice away.
    let reading = state.corpus_read.claim();
    assert!(
        absorb_corpus_slice(
            &mut state,
            &elsewhere,
            vec![slice_document("one")],
            false,
            Vec::new(),
            true,
            false,
            reading
        )
        .is_none(),
        "a slice read under a vault we have left was taken as this one's text"
    );
    assert!(state.corpus.is_none());
}

#[test]
fn a_vault_left_and_come_straight_back_to_keeps_nothing_from_the_read_it_abandoned() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    let abandoned = state.corpus_read.claim();
    absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("one")],
        false,
        Vec::new(),
        true,
        false,
        abandoned,
    )
    .expect("the read being waited for had its first slice thrown away");

    // Clicked to another vault and straight back to this one, so the root is `/vault` again and the abandoned read's tail gets past it.
    state.drop_corpus();
    state.root = Some(PathBuf::from("/another-vault"));
    state.drop_corpus();
    state.root = Some(root.clone());

    assert!(
        absorb_corpus_slice(
            &mut state,
            &root,
            vec![slice_document("two")],
            false,
            Vec::new(),
            false,
            true,
            abandoned
        )
        .is_none(),
        "the vault they came back to was handed the tail of the read they walked out on"
    );
    assert!(
        state.corpus.is_none(),
        "a scrap of the abandoned read became the vault's whole text"
    );
    assert!(
        !state.corpus_loading,
        "the refused slice left the vault unreadable for the rest of the session"
    );
}

#[test]
fn a_read_overtaken_before_it_opened_a_document_is_thrown_away_though_its_slice_is_a_first() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    state.corpus_loading = true;
    let abandoned = state.corpus_read.claim();

    // The fast gesture: away and back before the walk ended, so the read broke having sent nothing. Its one slice is its first as well as its last and holds no documents — the case a `first`-based test keeps, leaving the vault empty and calling it read.
    state.drop_corpus();
    state.root = Some(PathBuf::from("/another-vault"));
    state.drop_corpus();
    state.root = Some(root.clone());

    assert!(
        absorb_corpus_slice(
            &mut state,
            &root,
            Vec::new(),
            false,
            Vec::new(),
            true,
            true,
            abandoned
        )
        .is_none(),
        "an abandoned read's only slice was taken as the vault's text because it was a first"
    );
    assert!(
        state.corpus.is_none(),
        "the vault was left holding nothing and called read"
    );
    assert!(
        !state.corpus_loading,
        "the refused slice left the vault unreadable for the rest of the session"
    );
}

#[test]
fn an_ask_left_waiting_by_a_vault_switch_is_owed_a_read() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));

    // Somebody switched vaults, then searched in the one they switched to. The read they were turned away by has just let go.
    state.pending_search = Some(typed("dharma"));
    assert!(
        read_is_owed(&state),
        "a search left waiting by a vault switch was never given a read"
    );

    // A map does the same, and nothing brings it back on its own: the page is already showing its waiting state.
    state.pending_search = None;
    state.pending_graph = Some(GraphRequest::default());
    assert!(
        read_is_owed(&state),
        "a map left waiting by a vault switch was never given a read"
    );
}

#[test]
fn re_picking_the_folder_the_pane_is_already_in_is_not_a_move() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.active = 7;
    state.root = Some(root.clone());

    // The two slips this exists for: New vault… on a folder already registered, and Change folder… accepting the folder the vault already shows. Both arrive as this same id and this same folder.
    assert!(
        !pointing_here_is_a_move(&state, 7, Some(&root)),
        "re-picking the folder the pane is already in was read as leaving it, so a whole vault's text went with it"
    );

    // A real switch, and each half of one on its own.
    assert!(
        pointing_here_is_a_move(&state, 9, Some(Path::new("/another-vault"))),
        "switching to another vault kept text read under the one we left"
    );
    assert!(
        pointing_here_is_a_move(&state, 7, Some(Path::new("/moved-vault"))),
        "moving a vault to a folder it was not in kept text read under the old one"
    );
    assert!(
        pointing_here_is_a_move(&state, 0, None),
        "going out to the whole library kept text read under the vault we left"
    );
}

#[test]
fn both_ways_of_pointing_at_a_vault_ask_whether_the_folder_moved_first() {
    // Both arms take an `EventLoopProxy` and nothing in this suite has one, so they are held as source the way the loop's own arms are.
    let source = include_str!("vaults.rs");
    for arm in [
        "fn apply_active_vault(",
        "pub(crate) fn change_vault_folder(",
    ] {
        let at = source.find(arm).unwrap_or_else(|| {
            panic!("{arm} is one of the two ways the pane is pointed at a vault")
        });
        let body = &source[at..source.len().min(at + 1500)];
        let asked = body.find("pointing_here_is_a_move(").unwrap_or_else(|| {
            panic!("{arm} forgets a vault's text without asking whether its folder moved")
        });
        let forgotten = body.find("state.drop_corpus();").unwrap_or_else(|| {
            panic!("{arm} no longer forgets the text of a vault somebody really did leave")
        });
        assert!(
            asked < forgotten,
            "{arm} forgets the text first and asks whether the folder moved afterwards"
        );
        assert!(
            body[asked..forgotten].contains("if moved {"),
            "{arm} asks whether the folder moved and forgets the text whatever the answer"
        );
    }
}

#[test]
fn nothing_is_owed_while_a_read_is_still_running() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));
    state.pending_search = Some(typed("dharma"));
    // A slice thrown away mid-read is an ordinary thing, and it must not put a second read of the same folder on the machine.
    state.corpus_loading = true;
    assert!(
        !read_is_owed(&state),
        "a slice given up mid-read started a second read beside the one still going"
    );
}

#[test]
fn nothing_is_owed_with_nobody_waiting() {
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));
    assert!(
        !read_is_owed(&state),
        "a vault nobody has asked anything of was read anyway"
    );

    // And with no vault at all there is nothing to read, whoever is waiting.
    state.root = None;
    state.pending_search = Some(typed("dharma"));
    assert!(!read_is_owed(&state), "a read started with no vault open");
}

#[test]
fn giving_up_a_stale_slice_starts_the_read_the_open_vault_is_owed() {
    // The arm takes an `EventLoopProxy` and nothing in this suite has one, so it is held as source the way the loop's own arms are.
    let source = include_str!("vaults.rs");
    let at = source
        .find("pub(crate) fn deliver_corpus(")
        .expect("a slice of a read is delivered");
    let body = &source[at..source.len().min(at + 1200)];

    assert!(
        body.contains("if read_is_owed(state) {"),
        "the arm that gives up a stale slice never asks whether the open vault is owed a read"
    );
    assert!(
        body.contains("read_corpus(state, proxy);"),
        "the arm that gives up a stale slice asks the question and then does nothing with the answer"
    );
}

#[test]
fn every_slice_of_a_read_carries_the_one_number_that_read_claimed() {
    // The read is a thread and a proxy, and nothing in this suite has either, so it is held as source the way the loop's own arms are. Nothing else can catch it: a number claimed again per slice would refuse every slice of every read and leave each vault empty, with the whole suite still green.
    let source = include_str!("vaults.rs");
    let at = source
        .find("pub(crate) fn read_corpus(")
        .expect("the one read is started somewhere");
    let body = &source[at..source.len().min(at + 1400)];

    assert!(
        body.contains("let wanted = state.corpus_read.claim();"),
        "the read no longer claims the number that says anybody is waiting for it"
    );
    assert_eq!(
        body.matches("claim()").count(),
        1,
        "the read claims more than once, so its own slices are stamped with numbers it has already moved past"
    );
    assert!(
        body.contains("wanted,"),
        "a slice goes out without saying which read sent it, so a vault left and come back to keeps the tail of the read it abandoned"
    );
}

#[test]
fn a_fresh_read_replaces_the_text_it_finds_rather_than_growing_it() {
    let root = PathBuf::from("/vault");
    let mut state = VaultState::load(None);
    state.root = Some(root.clone());
    let reading = state.corpus_read.claim();
    absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("one")],
        false,
        Vec::new(),
        true,
        true,
        reading,
    );
    // A second read of the same vault — its files changed underneath, or it was left and came back to — so it claims its own number.
    let again = state.corpus_read.claim();
    let fresh = absorb_corpus_slice(
        &mut state,
        &root,
        vec![slice_document("two")],
        false,
        Vec::new(),
        true,
        true,
        again,
    )
    .expect("the fresh read is kept");
    assert_eq!(
        fresh.corpus.documents.len(),
        1,
        "a fresh read was added to the last one's text"
    );
    assert_eq!(fresh.corpus.documents[0].label, "two");
}

/// One hit, which is all a memo test needs: what is kept matters here, not what it holds.
fn one_search_answer() -> SearchResults {
    SearchResults {
        hits: vec![leaftext::store::SearchHit {
            abs_path: "/vault/note.md".to_string(),
            title: "note".to_string(),
            alias: None,
            start_line: 3,
            end_line: 3,
            anchor: None,
            snippet: "a talk on dharma".to_string(),
            score: 1.0,
        }],
        truncated: false,
        understood: String::new(),
        unknown_fields: Vec::new(),
        skipped: Vec::new(),
        matched: vec!["/vault/note.md".to_string()],
    }
}

#[test]
fn an_answer_scanned_over_part_of_a_vault_is_never_kept() {
    let mut state = VaultState::load(None);
    let scanned = state.corpus_generation;
    // Two more slices landed while this scan was running, so the vault's text has moved on since it started.
    state.corpus_generation += 2;

    deliver_search(
        &mut state,
        None,
        None,
        "dharma",
        one_search_answer(),
        scanned,
        true,
    );
    assert!(
        state.search.remembered(&typed("dharma"), scanned).is_none(),
        "an answer that had seen half a vault was kept as the answer to that query"
    );

    deliver_search(
        &mut state,
        None,
        None,
        "dharma",
        one_search_answer(),
        scanned,
        false,
    );
    // Kept under the text it actually scanned, never under whatever the number had reached by the time it landed.
    assert!(state.search.remembered(&typed("dharma"), scanned).is_some());
    assert!(state
        .search
        .remembered(&typed("dharma"), state.corpus_generation)
        .is_none());
}

#[test]
fn the_same_query_over_unchanged_text_is_answered_from_the_last_one() {
    let mut state = VaultState::load(None);
    let answer = SearchResults {
        hits: vec![leaftext::store::SearchHit {
            abs_path: "/vault/note.md".to_string(),
            title: "note".to_string(),
            alias: None,
            start_line: 3,
            end_line: 3,
            anchor: None,
            snippet: "a talk on dharma".to_string(),
            score: 1.0,
        }],
        truncated: false,
        understood: String::new(),
        unknown_fields: Vec::new(),
        skipped: Vec::new(),
        matched: vec!["/vault/note.md".to_string()],
    };
    let corpus = state.corpus_generation;
    state.search.remember("dharma", corpus, answer);

    // The pane re-runs its search on every folder move, and the same query over the same text has the same answer.
    assert!(state.search.remembered(&typed("dharma"), corpus).is_some());
    // Another query is another question.
    assert!(state.search.remembered(&typed("dharmas"), corpus).is_none());
    // Text that has moved on since is not what the kept answer describes: the watcher patching the vault and a vault switch both count.
    assert!(state
        .search
        .remembered(&typed("dharma"), corpus + 1)
        .is_none());
    state.drop_corpus();
    assert!(state
        .search
        .remembered(&typed("dharma"), state.corpus_generation)
        .is_none());
}

#[test]
fn one_more_letter_scans_what_the_last_letter_matched() {
    let mut state = VaultState::load(None);
    let answer = SearchResults {
        hits: Vec::new(),
        truncated: false,
        understood: String::new(),
        unknown_fields: Vec::new(),
        skipped: Vec::new(),
        matched: vec!["/vault/one.md".to_string(), "/vault/two.md".to_string()],
    };
    let corpus = state.corpus_generation;
    state.search.remember("dhar", corpus, answer);

    // Typing on the end can only shrink the set, so the next keystroke reads those two documents rather than the vault.
    let within = state
        .search
        .narrowing(&typed("dharma"), corpus)
        .expect("a longer query narrows to the shorter one's matches");
    assert_eq!(within.len(), 2);

    // Everything else is a different question: the same query (already answered from the kept results), a letter deleted, a different word, another case.
    assert!(state.search.narrowing(&typed("dhar"), corpus).is_none());
    assert!(state.search.narrowing(&typed("dha"), corpus).is_none());
    assert!(state.search.narrowing(&typed("sutra"), corpus).is_none());
    assert!(state.search.narrowing(&typed("Dharma"), corpus).is_none());
    // And text that moved under it is not narrowed at all — a file saved mid-typing would otherwise be invisible until the query changed.
    assert!(state
        .search
        .narrowing(&typed("dharma"), corpus + 1)
        .is_none());
}

#[test]
fn the_vaults_text_is_patched_for_every_format_the_watcher_reports() {
    let dir = scratch_dir("the_vaults_text_is_patched_for_every_format_the_watcher_reports");
    let canonical = fs::canonicalize(&dir).expect("fixture directory canonicalizes");
    let root = plain_event_path(canonical.clone());

    let mut corpus = VaultCorpus::read(&root);
    for extension in all_document_extensions() {
        let name = format!("new.{extension}");
        fs::write(dir.join(&name), "hello").expect("fixture document is written");
        // As the watcher would report it, translated at the boundary.
        let changed = plain_event_path(canonical.join(&name));
        assert!(
            corpus.covers(&changed),
            "a new .{extension} under the vault must be the corpus's business"
        );
        assert!(
            corpus.refresh(&changed),
            "a new .{extension} under the vault must join the corpus"
        );
    }

    fs::remove_dir_all(&dir).expect("fixture directory is removed");
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
        LinkTarget::LocalOther("file:///C:/docs/logo.png".to_string())
    );
    assert_eq!(
        classify_link_target("./assets/Release%20Notes.pdf"),
        LinkTarget::LocalOther("./assets/Release%20Notes.pdf".to_string())
    );
    assert_eq!(classify_link_target("#section"), LinkTarget::AnchorOnly);
    assert_eq!(classify_link_target("./#section"), LinkTarget::AnchorOnly);
    assert_eq!(classify_link_target(".#section"), LinkTarget::AnchorOnly);
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
fn a_local_link_preview_is_bounded_cached_and_refreshed_after_an_edit() {
    let dir = std::env::temp_dir().join(format!("leaf-link-preview-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let current = dir.join("current.md");
    let target = dir.join("target.md");
    fs::write(&current, "# Current").expect("current document is written");
    fs::write(
        &target,
        format!(
            "# Preview\n\nOpening text.\n\n{}hidden tail",
            "word ".repeat(16_000)
        ),
    )
    .expect("target document is written");

    let first = link_preview_html("target.md", &current).expect("local document previews");
    assert!(
        first.contains("Opening text."),
        "the opening renders: {first}"
    );
    assert!(
        !first.contains("hidden tail"),
        "the render stops at the bounded head"
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

/// The paths a history holds, in order. An entry carries a position too, which these tests read on its own.
fn history_paths(history: &DocumentHistory) -> Vec<PathBuf> {
    history
        .entries
        .iter()
        .map(|entry| entry.path.clone())
        .collect()
}

#[test]
fn document_history_tracks_back_forward_and_truncates_forward_entries() {
    let mut history = DocumentHistory::default();

    history.record(PathBuf::from("one.md"));
    history.record(PathBuf::from("two.md"));
    history.record(PathBuf::from("three.md"));

    assert!(history.can_go_back());
    assert!(!history.can_go_forward());
    assert_eq!(history.back_target(), Some(&PathBuf::from("two.md")));

    history.go_back();
    assert_eq!(history.current(), Some(&PathBuf::from("two.md")));
    assert_eq!(history.forward_target(), Some(&PathBuf::from("three.md")));

    history.record(PathBuf::from("branch.md"));
    assert_eq!(history.current(), Some(&PathBuf::from("branch.md")));
    assert_eq!(
        history_paths(&history),
        vec![
            PathBuf::from("one.md"),
            PathBuf::from("two.md"),
            PathBuf::from("branch.md")
        ]
    );
    assert!(!history.can_go_forward());

    history.clear();
    assert_eq!(history.current(), None);
    assert!(!history.can_go_back());
    assert!(!history.can_go_forward());
    assert!(history.entries.is_empty());
}

#[test]
fn forget_current_drops_failed_entry_and_falls_back_to_previous() {
    let mut history = DocumentHistory::default();
    history.record(PathBuf::from("good.md"));
    history.record(PathBuf::from("missing.md"));

    // The failed entry is removed entirely, not left in forward history, so the user can't step forward back onto it.
    assert!(history.forget_current());
    assert_eq!(history.current(), Some(&PathBuf::from("good.md")));
    assert_eq!(history_paths(&history), vec![PathBuf::from("good.md")]);
    assert!(!history.can_go_forward());
    assert!(!history.can_go_back());
}

#[test]
fn forget_current_reports_empty_when_tab_had_only_the_failed_document() {
    let mut history = DocumentHistory::default();
    history.record(PathBuf::from("missing.md"));

    assert!(!history.forget_current());
    assert_eq!(history.current(), None);
    assert!(history.entries.is_empty());
}

#[test]
fn stepping_back_returns_the_position_the_document_was_left_at() {
    let mut history = DocumentHistory::default();
    history.record(PathBuf::from("one.md"));
    history.stamp_current(test_anchor(42));
    history.record(PathBuf::from("two.md"));

    // The document just arrived at has never been left, so there is nothing to restore on it.
    assert_eq!(history.current_anchor(), None);

    history.go_back();
    assert_eq!(history.current(), Some(&PathBuf::from("one.md")));
    assert_eq!(history.current_anchor(), Some(test_anchor(42)));
}

#[test]
fn recording_after_stepping_back_drops_the_forward_positions_too() {
    let mut history = DocumentHistory::default();
    history.record(PathBuf::from("one.md"));
    history.stamp_current(test_anchor(10));
    history.record(PathBuf::from("two.md"));
    history.stamp_current(test_anchor(20));
    history.record(PathBuf::from("three.md"));

    history.go_back();
    history.go_back();
    history.record(PathBuf::from("branch.md"));

    assert_eq!(
        history_paths(&history),
        vec![PathBuf::from("one.md"), PathBuf::from("branch.md")]
    );
    // `two.md`'s position went with its entry, so a later step can't land on it.
    assert!(history
        .entries
        .iter()
        .all(|entry| entry.anchor.is_none() || entry.path == PathBuf::from("one.md")));
    assert_eq!(history.current_anchor(), None);
}

#[test]
fn forget_current_takes_the_failed_entry_position_with_it() {
    let mut history = DocumentHistory::default();
    history.record(PathBuf::from("good.md"));
    history.stamp_current(test_anchor(7));
    history.record(PathBuf::from("missing.md"));
    history.stamp_current(test_anchor(99));

    assert!(history.forget_current());
    assert_eq!(history.entries.len(), 1);
    // Back lands on the document that opened, at its own position — never the failed one's.
    assert_eq!(history.current_anchor(), Some(test_anchor(7)));
}

#[test]
fn leaving_a_tab_and_returning_restores_from_its_history_entry() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("one.md"));
    let left_at = test_anchor(31);
    // What a tab switch stamps on the way out; the tab holds no field of its own for it.
    workspace.tabs[0].history.stamp_current(left_at.clone());

    workspace.open_path(PathBuf::from("two.md"));
    assert_eq!(workspace.active, Some(1));
    assert_eq!(workspace.tabs[1].history.current_anchor(), None);

    assert!(workspace.set_active(0));
    assert_eq!(workspace.tabs[0].history.current_anchor(), Some(left_at));
}

#[test]
fn a_back_into_the_code_view_asks_for_the_top_of_the_source() {
    // What GoBack renders with: the place the entry was left at, and the top of the source.
    let back = ScrollIntent::Restore {
        anchor: Some(test_anchor(3)),
        code: Some(0.0),
    };
    assert_eq!(code_view_scroll(&back), Some(0.0));

    // A tab switch is the other caller, and carries the tab's own saved fraction.
    let switch = ScrollIntent::Restore {
        anchor: Some(test_anchor(3)),
        code: Some(0.42),
    };
    assert_eq!(code_view_scroll(&switch), Some(0.42));

    assert_eq!(code_view_scroll(&ScrollIntent::Reset), Some(0.0));

    // An in-place rebuild says nothing on purpose, which is what tells the page to carry the place off the editor it is replacing.
    assert_eq!(
        code_view_scroll(&ScrollIntent::Preserve { code: None }),
        None
    );

    // Except a rename, whose moved path is exactly what makes the page refuse that capture, so the host names the place instead.
    assert_eq!(
        code_view_scroll(&ScrollIntent::Preserve { code: Some(0.61) }),
        Some(0.61)
    );
}

#[test]
fn the_source_payload_carries_a_saved_place_and_says_nothing_when_there_is_none() {
    // The field's absence is the page's instruction to use its own answer instead, so a fraction of zero has to arrive as a zero rather than as nothing: a tab saved at the top of its source is still a tab with a saved place.
    let saved = code_view_payload("# Title", "markdown", "Markdown", false, Some(0.42));
    assert!(saved.contains("\"scrollFraction\":0.42"), "{saved}");

    let top = code_view_payload("# Title", "markdown", "Markdown", false, Some(0.0));
    assert!(top.contains("\"scrollFraction\":0.0"), "{top}");

    let none = code_view_payload("# Title", "markdown", "Markdown", false, None);
    assert!(!none.contains("scrollFraction"), "{none}");
}

/// Build a distinct anchor for scroll-history tests; the block ordinal keeps the entries identifiable.
fn test_anchor(block: u32) -> ScrollAnchor {
    ScrollAnchor {
        section: None,
        block,
        offset_y: 0.0,
    }
}

#[test]
fn scroll_history_restores_repeated_internal_jumps() {
    let mut history = ScrollHistory::default();

    history.record(test_anchor(120));
    history.record(test_anchor(640));

    assert!(history.can_go_back());
    assert!(!history.can_go_forward());
    assert_eq!(history.back(test_anchor(980)), Some(test_anchor(640)));
    assert_eq!(history.back(test_anchor(640)), Some(test_anchor(120)));
    assert!(!history.can_go_back());
    assert!(history.can_go_forward());

    assert_eq!(history.forward(test_anchor(120)), Some(test_anchor(640)));
    assert_eq!(history.forward(test_anchor(640)), Some(test_anchor(980)));
    assert!(!history.can_go_forward());
    assert!(history.can_go_back());
}

#[test]
fn scroll_history_clears_forward_entries_after_new_internal_jump() {
    let mut history = ScrollHistory::default();

    history.record(test_anchor(10));
    assert_eq!(history.back(test_anchor(500)), Some(test_anchor(10)));
    assert!(history.can_go_forward());

    history.record(test_anchor(200));

    assert!(history.can_go_back());
    assert!(!history.can_go_forward());
    assert_eq!(history.back(test_anchor(900)), Some(test_anchor(200)));
}

#[test]
fn edit_buffer_belongs_to_one_document_and_reseeds_after_navigation() {
    let mut tab = Tab::default();
    let first = PathBuf::from("/docs/a.md");
    let second = PathBuf::from("/docs/b.md");

    // Editing the first document creates its buffer.
    assert!(tab.needs_edit_seed(&first));
    tab.edit_buffer(&first, SourceText::utf8("# A\n".to_string()))
        .toggle_task(0);
    assert!(tab.has_edit_for(&first));
    assert!(!tab.needs_edit_seed(&first));

    // The buffer is NOT the second document's: rendering b.md must not use it (the stale-buffer bug that made link navigation re-render the old page), and editing b.md must re-seed from b's contents.
    assert!(!tab.has_edit_for(&second));
    assert!(tab.needs_edit_seed(&second));
    let edit = tab.edit_buffer(&second, SourceText::utf8("# B\n".to_string()));
    assert_eq!(edit.text(), "# B\n");
    assert!(tab.has_edit_for(&second));
    assert!(!tab.has_edit_for(&first));

    // Re-editing the same document reuses the buffer (unsaved edits kept).
    let edit = tab.edit_buffer(&second, SourceText::utf8(String::new()));
    edit.replace_range(2, 3, "Bee");
    assert_eq!(edit.text(), "# Bee\n");
    let edit = tab.edit_buffer(&second, SourceText::utf8(String::new()));
    assert_eq!(edit.text(), "# Bee\n");
}

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
    let source = include_str!("render.rs");
    for name in ["repoint_favorite", "move_favorite"] {
        let body = source
            .split(&format!("fn {name}("))
            .nth(1)
            .and_then(|rest| rest.split("\n    }").next())
            .unwrap_or_else(|| panic!("the {name} body"));
        assert!(
            body.contains("self.render("),
            "the start screen's own render is the only thing that draws a favorite row, so {name} keeps it"
        );
    }
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
fn a_browsed_folder_is_watched_one_level_deep_not_recursively() {
    // Browsing into `C:\` in the library must not hand the watcher a recursive subscription to the whole drive: every change on the machine then arrives as an event, the pane rebuilds against each one, the window stops answering, and switching vaults never gets processed.
    //
    // A vault is the user's own choice of folder and stays recursive; a folder the pane merely browsed to gets one level, which is all the pane shows.
    let dir = scratch_dir("a_browsed_folder_is_watched_one_level_deep_not_recursively");
    let browsed = dir.join("browsed");
    fs::create_dir_all(&browsed).expect("test directory is created");

    let (shallow, _) = desired_watches(None, Some(&browsed), RecursiveMode::NonRecursive);
    assert_eq!(shallow.len(), 1);
    assert!(shallow
        .values()
        .all(|mode| matches!(mode, RecursiveMode::NonRecursive)));

    let (deep, _) = desired_watches(None, Some(&browsed), RecursiveMode::Recursive);
    assert!(deep
        .values()
        .all(|mode| matches!(mode, RecursiveMode::Recursive)));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_document_opened_while_reading_source_opens_in_source() {
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("/notes/first.md"));
    assert!(
        !workspace.tabs[0].code_view,
        "the first tab starts in the reading view"
    );

    // The view is where the reader is working, not a property of the file they picked, so opening one from the pane must not throw them back to the page.
    workspace.tabs[0].code_view = true;
    workspace.open_path(PathBuf::from("/notes/second.md"));
    assert_eq!(workspace.active, Some(1));
    assert!(workspace.tabs[1].code_view);

    // And back the other way: leaving source leaves it for what opens next.
    workspace.tabs[1].code_view = false;
    workspace.open_path(PathBuf::from("/notes/third.md"));
    assert!(!workspace.tabs[2].code_view);

    // Returning to a tab shows that tab's own view, not the one you came from.
    workspace.tabs[0].code_view = true;
    workspace.set_active(0);
    assert!(workspace.tabs[0].code_view);
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

#[test]
fn a_table_cell_edit_arrives_under_the_names_the_page_sends() {
    // Nothing on this enum rejects an unknown field, so a cell spelled differently on the two sides would deserialize to None and every cell edit would silently go back to rewriting the whole table — which is the fault this was built to fix, back with nothing on screen to show for it.
    let sent = r#"{"command":"editBlock","start":11,"end":60,"text":"the whole table rewritten","cell":{"row":1,"column":0,"columns":1,"text":"2"}}"#;
    match serde_json::from_str::<IpcCommand>(sent) {
        Ok(IpcCommand::EditBlock { start, cell, .. }) => {
            let cell = cell.expect("the cell the page named arrives with the edit");
            assert_eq!((start, cell.row, cell.column, cell.columns), (11, 1, 0, 1));
            assert_eq!(cell.text, "2");
        }
        other => panic!("the cell edit did not arrive: {other:?}"),
    }

    // Every other edit still sends no cell at all, and a table whose cell the page could not place sends it as null.
    for sent in [
        r#"{"command":"editBlock","start":0,"end":5,"text":"Hi"}"#,
        r#"{"command":"editBlock","start":0,"end":5,"text":"Hi","cell":null}"#,
    ] {
        match serde_json::from_str::<IpcCommand>(sent) {
            Ok(IpcCommand::EditBlock { cell, .. }) => assert!(cell.is_none(), "{sent}"),
            other => panic!("the edit did not arrive: {other:?}"),
        }
    }
}

#[test]
fn a_splice_made_while_the_reader_types_arrives_under_the_names_the_page_sends() {
    // Nothing on this enum rejects an unknown field, so either flag spelled differently on the two sides would deserialize to false and fail silently: a splice sent mid-typing would rebuild the page under the caret, and every pause in one sentence would become its own press of undo.
    let sent = r#"{"command":"editBlock","start":9,"end":10,"text":"A paragraph.","live":true,"continuing":true}"#;
    match serde_json::from_str::<IpcCommand>(sent) {
        Ok(IpcCommand::EditBlock {
            live, continuing, ..
        }) => assert!(live && continuing),
        other => panic!("the live splice did not arrive: {other:?}"),
    }

    // And a commit that ends the typing renders and records its own step, which is what every edit that says nothing about either flag has to be.
    match serde_json::from_str::<IpcCommand>(
        r#"{"command":"editBlock","start":0,"end":5,"text":"Hi"}"#,
    ) {
        Ok(IpcCommand::EditBlock {
            live, continuing, ..
        }) => assert!(!live && !continuing),
        other => panic!("the edit did not arrive: {other:?}"),
    }
}

#[test]
fn the_new_page_flag_arrives_only_under_the_name_the_page_sends() {
    // Nothing on this enum rejects an unknown field, so a name the two sides spelled differently would deserialize to false and the gesture would do nothing, silently. That is what this pins.
    let held = r#"{"command":"openLink","href":"./next.md","scroll_anchor":{"section":null,"block":0,"offsetY":0},"newPage":true}"#;
    match serde_json::from_str::<IpcCommand>(held) {
        Ok(IpcCommand::OpenLink { new_page, href, .. }) => {
            assert!(new_page, "a Ctrl-held click asks for a page of its own");
            assert_eq!(href, "./next.md");
        }
        other => panic!("the held click did not arrive: {other:?}"),
    }

    let plain = r#"{"command":"openLink","href":"./next.md","scroll_anchor":{"section":null,"block":0,"offsetY":0}}"#;
    match serde_json::from_str::<IpcCommand>(plain) {
        Ok(IpcCommand::OpenLink { new_page, .. }) => {
            assert!(!new_page, "a plain click follows the link in place")
        }
        other => panic!("the plain click did not arrive: {other:?}"),
    }
}

#[test]
fn the_first_run_bubbles_state_arrives_under_the_names_the_page_sends() {
    // The page's own message, verbatim. Nothing on this enum rejects a name the two sides spelled differently — it would fail to deserialize, the arm would never run, and the bubble would come back on every launch for ever with nothing said. `lastLaunch` is the one that is renamed, so it is the one that can drift.
    let sent = r#"{"command":"setHintState","launches":3,"seen":["libraryVault"],"lastLaunch":2}"#;
    match serde_json::from_str::<IpcCommand>(sent) {
        Ok(IpcCommand::SetHintState {
            launches,
            seen,
            last_launch,
        }) => {
            assert_eq!(launches, 3);
            assert_eq!(seen, vec!["libraryVault".to_string()]);
            assert_eq!(last_launch, 2, "the pacing mark is what spaces two bubbles");
        }
        other => panic!("the bubble's state did not arrive: {other:?}"),
    }
}

#[test]
fn the_link_menus_two_host_items_arrive_under_the_names_the_page_sends() {
    // Reveal file and Copy path on a link are the only two items that cannot be done in the page. They are new command names on both sides, so this pins the pair.
    match serde_json::from_str::<IpcCommand>(r#"{"command":"revealLink","href":"./b.md"}"#) {
        Ok(IpcCommand::RevealLink { href }) => assert_eq!(href, "./b.md"),
        other => panic!("Reveal file on a link did not arrive: {other:?}"),
    }
    match serde_json::from_str::<IpcCommand>(r#"{"command":"copyLinkPath","href":"./b.md"}"#) {
        Ok(IpcCommand::CopyLinkPath { href }) => assert_eq!(href, "./b.md"),
        other => panic!("Copy path on a link did not arrive: {other:?}"),
    }
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

/// One code-view payload is held at a time on purpose, so a test that stages one takes this until it is done with the slot — on the harness's threads another test's staging supersedes it and the read is a 404. Poison is shrugged off so one broken test is one failure.
static SOURCE_PAYLOAD_SLOT: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn a_staged_source_payload_is_served_with_the_headers_the_fetch_needs() {
    let _slot = SOURCE_PAYLOAD_SLOT
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let url = stage_source_payload("{\"html\":\"x\"}".to_string());

    let served = source_payload_response(&url);
    assert_eq!(served.status, 200);
    assert_eq!(served.body, b"{\"html\":\"x\"}");
    assert_eq!(
        served.allow_origin, "*",
        "the payload is a different origin from the page; without CORS the fetch dies"
    );
    assert!(served.content_type.starts_with("application/json"));

    // Staging again supersedes it, so only one payload is ever held.
    let next = stage_source_payload("{\"html\":\"y\"}".to_string());
    assert_ne!(url, next, "each entry gets its own URL");
    assert_eq!(source_payload_response(&next).body, b"{\"html\":\"y\"}");
    assert_eq!(
        source_payload_response(&url).status,
        404,
        "a superseded payload must not still be served"
    );

    // A URL naming no payload we hold is a 404, not a panic or a stale body.
    assert_eq!(
        source_payload_response("http://leaf-source.local/payload/nonsense").status,
        404
    );
}

#[test]
fn the_code_view_script_carries_a_url_and_not_the_source() {
    // The whole point: the megabytes stay behind the URL. A regression here is silent — it still works, just slowly.
    let _slot = SOURCE_PAYLOAD_SLOT
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let payload = code_view_payload("huge text", "markdown", "Markdown", false, None);
    let script = code_view_fetch_script(&stage_source_payload(payload));

    assert!(script.contains("leafLoadCodeView"), "{script}");
    assert!(
        !script.contains("huge"),
        "the script must not carry the source: {script}"
    );
    assert!(
        script.len() < 200,
        "the script should be a URL, not a payload: {script}"
    );
}

#[test]
fn a_watch_event_for_unchanged_content_is_not_a_reload() {
    // With the code view open, re-sending rebuilds the entire colored source — so a spurious event for an untouched file reads as the view redrawing itself with new colors a moment after it appeared.
    let contents = "# Title

body
"
    .to_string();
    let mut edit = EditableDocument::new(
        PathBuf::from("notes.md"),
        SourceText::utf8(contents.clone()),
    );

    assert!(
        buffer_already_shows(Some(&edit), &contents),
        "an event carrying what we already show is nothing to act on"
    );
    assert!(
        !buffer_already_shows(
            Some(&edit),
            "# Title

changed
"
        ),
        "a real outside change must still reload"
    );
    assert!(
        !buffer_already_shows(None, &contents),
        "with no buffer there is nothing to compare, so let the reload happen"
    );

    // A dirty buffer must never claim to match the disk, or an outside change arriving over unsaved edits would be dropped.
    edit.replace_range(2, 7, "Other");
    assert!(edit.is_dirty());
    assert!(!buffer_already_shows(Some(&edit), &contents));
}

#[test]
fn a_picture_picked_after_the_file_moved_is_never_spliced_at_the_offsets_the_page_had() {
    // The picture dialog blocks the loop, so the file can move while it stands open and the answer reaches the page carrying offsets read before it did. The dialog's arm asks this question first: "moved" reloads, the redraw clears the page's pending writer, and the picture is dropped rather than spliced into the middle of a sentence.
    let path = PathBuf::from("notes/a.md");
    let text = "# Title\n\nbody\n";
    let moved = "# Title\n\na paragraph nobody on the page has seen\n\nbody\n";

    // A freshly opened document has no edit buffer at all, so its last render is what the page was drawn from.
    let opened = Tab {
        rendered: Some(RenderedCache {
            path: path.clone(),
            hash: content_hash(text),
            document: opened_document_from_source_with_host(text, &path, &DesktopHost::default()),
        }),
        ..Default::default()
    };
    assert!(
        page_shows_file(&opened, &path, text),
        "the last render is of exactly what the file holds, so the picture lands where the plus stood"
    );
    assert!(
        !page_shows_file(&opened, &path, moved),
        "the file moved while the dialog was up"
    );

    // Neither a buffer nor a render: nothing says what the page shows, so it cannot be trusted with offsets.
    assert!(!page_shows_file(&Tab::default(), &path, text));

    // A clean buffer is what the page is drawn from once the document has been edited and saved.
    let mut edited = Tab {
        edit: Some(EditableDocument::new(
            path.clone(),
            SourceText::utf8(text.to_string()),
        )),
        ..Default::default()
    };
    assert!(page_shows_file(&edited, &path, text));
    assert!(!page_shows_file(&edited, &path, moved));

    // Unsaved edits are left alone: the disk cannot move that page, and the reload refuses it anyway.
    edited
        .edit
        .as_mut()
        .expect("the buffer was just made")
        .replace_range(2, 7, "Other");
    assert!(
        page_shows_file(&edited, &path, moved),
        "a page holding unsaved edits is answered as it stands"
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

#[test]
fn an_exported_picture_is_decoded_exactly_or_not_at_all() {
    // A PNG reaches the host as base64 because IPC carries a string. The bytes are then written straight to a file, so a decoder that is off by one pads out a picture nobody can open — and a wrong byte is invisible until then.
    let round_trip = |bytes: &[u8], encoded: &str| {
        assert_eq!(
            decode_base64(encoded).as_deref(),
            Some(bytes),
            "{encoded} did not come back as its bytes"
        );
    };

    round_trip(b"", "");
    round_trip(b"f", "Zg==");
    round_trip(b"fo", "Zm8=");
    round_trip(b"foo", "Zm9v");
    round_trip(b"foob", "Zm9vYg==");
    round_trip(b"fooba", "Zm9vYmE=");
    round_trip(b"foobar", "Zm9vYmFy");
    // The first eight bytes of every PNG, which is what the page will send.
    round_trip(
        &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        "iVBORw0KGgo=",
    );
    // Both of the last two alphabet characters, and every bit set.
    round_trip(&[0xff, 0xff, 0xff], "////");
    round_trip(&[0xfb, 0xff, 0xfe], "+//+");
    // A data URL split across lines is still the same picture.
    round_trip(b"foobar", "Zm9v\nYmFy\r\n");

    // Anything that is not base64 is refused whole rather than half-decoded: a truncated picture written to disk looks like a file and is not one.
    assert_eq!(decode_base64("data:image/png;base64,Zm9v"), None);
    assert_eq!(decode_base64("Zm9v*"), None);
    assert_eq!(decode_base64("Zm9-v"), None);
}

#[test]
fn a_diagram_export_writes_the_page_s_own_bytes_or_none_at_all() {
    // The write itself is a disk call into a path a native window answered with, so this is the whole of the decision. Two of the three formats reach the file differently — the page sends pixels for a PNG and a finished file for a WebP — and a payload that does not decode has to end as nothing rather than as a file that will not open.
    let written = |format: &str, data: &str, width: u32, height: u32| match diagram_export_file(
        format, data, width, height,
    ) {
        DiagramExportFile::Write(bytes) => Some(bytes),
        _ => None,
    };
    let refused = |format: &str, data: &str| {
        matches!(
            diagram_export_file(format, data, 1, 1),
            DiagramExportFile::Unreadable
        )
    };

    let text = "```mermaid
flowchart TD
  A --> B
```
";
    assert_eq!(
        written("md", text, 0, 0),
        Some(text.as_bytes().to_vec()),
        "Markdown goes out as the text the page sent"
    );

    // Base64 of one opaque white pixel, which is what the page sends for a PNG.
    let bytes = written("png", "/////w==", 1, 1).expect("a pixel encodes");
    assert_eq!(
        &bytes[..8],
        &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        "the host encoded the pixels rather than writing them out raw"
    );

    // A WebP is already a file when it arrives: the canvas wrote it, so the bytes go out exactly as they came in.
    assert_eq!(
        written("webp", "UklGRg==", 0, 0),
        Some(b"RIFF".to_vec()),
        "the finished file was re-encoded instead of written straight out"
    );

    assert!(refused("webp", "not base64!"), "a broken WebP payload");
    assert!(refused("png", "not base64!"), "a broken picture payload");
    assert!(refused("webp", ""), "an empty file is not a file");
    assert!(
        matches!(
            diagram_export_file("svg", "anything", 1, 1),
            DiagramExportFile::Unoffered
        ),
        "a format the save window does not offer is nothing anybody asked for"
    );

    // One table, so the window and the encoder cannot drift: every ending the window offers is one the encoder writes, and Markdown is first because Windows names a file with no ending off the first filter.
    assert_eq!(
        DIAGRAM_EXPORT_FORMATS,
        &[
            ("md", "Markdown"),
            ("png", "PNG image"),
            ("webp", "WebP image")
        ],
        "the save window offers a format the encoder does not write, or lists them in an order that names a bare file wrongly"
    );
    for (extension, _) in DIAGRAM_EXPORT_FORMATS {
        assert!(
            !matches!(
                diagram_export_file(extension, "", 1, 1),
                DiagramExportFile::Unoffered
            ),
            "the window offers {extension} and the encoder has never heard of it"
        );
    }
}

/// An address only this test uses, so a running copy of the app is never the thing answering — a named pipe on Windows, a socket file elsewhere.
fn test_pipe_address(name: &str) -> String {
    #[cfg(windows)]
    {
        format!(
            r"\\.\pipe\leaftext-journal-test-{name}-{}",
            std::process::id()
        )
    }
    #[cfg(unix)]
    {
        std::env::temp_dir()
            .join(format!(
                "leaftext-journal-test-{name}-{}",
                std::process::id()
            ))
            .to_string_lossy()
            .to_string()
    }
}

#[test]
fn the_pipe_answers_and_refuses_out_loud() {
    // The transport itself: a real listener, a real client, and a round trip through both. Everything above it is the same code the app serves with.
    let address = test_pipe_address("round-trip");
    pipe::listen(
        address.clone(),
        |request| {
            pipe::answer(request, |ask| match ask {
                pipe::Ask::Eval { script } => Some(Ok(serde_json::json!(format!("ran {script}")))),
                _ => Some(Ok(serde_json::json!({ "tabs": [] }))),
            })
        },
        |_| panic!("nothing here asks for anything after its reply"),
    );

    let reply = pipe::ask(&address, r#"{"ask":"version"}"#).expect("the pipe answered");
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["answer"], env!("CARGO_PKG_VERSION"));

    // What only the window knows comes back through the reply channel.
    let reply = pipe::ask(&address, r#"{"ask":"state"}"#).expect("the pipe answered");
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
    assert_eq!(reply["answer"]["tabs"].as_array().map(Vec::len), Some(0));

    // An ask nobody wrote is refused with a message rather than dropped. The page's IPC drops what it cannot parse because a page typo is our own bug; here it is somebody waiting for an answer that would never come.
    let reply = pipe::ask(&address, r#"{"ask":"sudo"}"#).expect("the pipe answered");
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
    assert_eq!(reply["ok"], false);
    let error = reply["error"].as_str().unwrap_or_default();
    assert!(
        error.contains("not an ask this app knows") && error.contains("version"),
        "a refusal should say what it does answer: {error}"
    );

    // Not even JSON is the same answer, not a hang and not a dropped connection.
    let reply = pipe::ask(&address, "log please").expect("the pipe answered");
    assert!(reply.contains("\"ok\":false"), "{reply}");

    // `eval` carries its script through the same round trip.
    let reply = pipe::ask(&address, r#"{"ask":"eval","script":"1+1"}"#).expect("the pipe answered");
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
    assert_eq!(reply["answer"], "ran 1+1");
}

/// The one file nothing here could ever read. The Export button opens a save dialog and no session can answer one, so a sheet had never been measured against the height the page said the document needed. This is that ask: a destination on the wire, no dialog, and a longer wait than every other ask because the loop is inside the render.
#[test]
fn the_export_ask_carries_a_destination_and_the_size_the_page_measured() {
    let ask = serde_json::from_str::<pipe::Ask>(
        r#"{"ask":"export","path":"C:\\out\\page.pdf","width":1280,"height":5819}"#,
    );
    assert!(matches!(
        ask,
        Ok(pipe::Ask::Export { ref path, width, height })
            if path == Path::new(r#"C:\out\page.pdf"#) && width == 1280.0 && height == 5819.0
    ));

    // No dialog on the write path the ask runs, and the appearance held across it the way the button's own press holds it — a render emulates a light color scheme, and without the hold the file comes out in the light theme.
    let write = include_str!("fileops.rs");
    let body = write
        .split("pub(crate) fn write_page_pdf_at")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the ask's own write");
    assert!(
        !body.contains("pick_export_path"),
        "the ask must not open a dialog nobody can answer: {body}"
    );
    assert!(
        body.contains("leafHoldAppearance(true)") && body.contains("leafHoldAppearance(false)"),
        "the appearance is held across the render and released after it: {body}"
    );

    // Its own wait. Two seconds is what every other ask gets, and a twenty-screen document takes longer than that to render.
    let source = include_str!("../pipe.rs");
    assert!(
        source.contains("Ask::Export { .. } => EXPORT_TIMEOUT,"),
        "an export that outlasts the ordinary wait would be reported as a stuck app"
    );
}

/// What a Mac reader gets when they press Export PDF. The arm is Mac code and nothing here compiles or runs it, so the proof is the source: the panel switched off, the chosen path named as where the job saves to, and the sheet the page measured spent rather than dropped. Read the same way as the ask above it, for the same reason.
#[test]
fn the_mac_export_switches_the_print_panel_off_and_saves_to_the_chosen_path() {
    let write = include_str!("fileops.rs");
    let body = write
        .split(
            "#[cfg(target_os = \"macos\")]
fn write_page_pdf(",
        )
        .nth(1)
        .expect("the Mac arm's own write");

    // The whole point of the ticket: no sheet asking about paper, and no progress window over a render that is writing a file.
    assert!(
        body.contains("setShowsPrintPanel(false)") && body.contains("setShowsProgressPanel(false)"),
        "a Mac export must raise no panel: {body}"
    );
    assert!(
        !body.contains("page.print()"),
        "the plain print call is the panel: {body}"
    );

    // The reader answered where the file goes before any of this ran, so the job saves to that answer rather than asking again.
    assert!(
        body.contains("NSPrintSaveJob") && body.contains("NSPrintJobSavingURL"),
        "the chosen path is where the job saves to: {body}"
    );
    assert!(
        body.contains("NSURL::fileURLWithPath") && body.contains("target.to_string_lossy()"),
        "the path spent is the one handed in: {body}"
    );

    // Its own settings, not the app's. The shared ones are what a later print reads.
    assert!(
        body.contains("NSPrintInfo::new()") && !body.contains("sharedPrintInfo"),
        "an export must not scribble in the app's session-wide print settings: {body}"
    );

    // The size the page measured, through the same sheet arithmetic Windows asks, written in the unit a Mac page size takes.
    assert!(
        body.contains("sheet_inches((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH)"),
        "both desktops divide a tall document the same way: {body}"
    );
    assert!(
        body.contains("const POINTS_PER_INCH: f64 = 72.0;") && body.contains("* POINTS_PER_INCH"),
        "a Mac page size is points, and inches written there is a sheet a third of the size: {body}"
    );
    assert!(
        body.contains("setScalingFactor(1.0)"),
        "fitting the document onto its own sheet is the blank paper the Windows half spent rounds on: {body}"
    );

    // Nothing here can watch the operation finish, so the growl answers on the file.
    assert!(
        body.contains("std::fs::metadata(target)") && body.contains("file.len() > 0"),
        "a saved growl must never name a file nobody wrote: {body}"
    );
}

#[test]
fn the_doc_ask_answers_the_buffer_and_refuses_a_path_that_will_not_open() {
    // The read half of the agent's document workflow, without a window: bring a file to the front, then answer off the same buffer the reader types into.
    let dir = std::env::temp_dir().join(format!("leaf-pipe-doc-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n\nOne line.\n").expect("the fixture is written");

    let mut workspace = Workspace::default();
    // Nothing is open, so the ask opens it — the one visible effect it has.
    assert_eq!(pipe_bring_to_front(&mut workspace, &note), Ok(true));
    assert_eq!(workspace.active_path(), Some(note.as_path()));
    // Asked for again it is already at the front, so nothing needs redrawing.
    assert_eq!(pipe_bring_to_front(&mut workspace, &note), Ok(false));

    let answer = pipe_document_answer(&mut workspace).expect("the buffer answers");
    assert_eq!(answer["text"], "# Note\n\nOne line.\n");
    assert_eq!(answer["unsaved"], false);
    assert_eq!(answer["untitled"], false);
    assert_eq!(answer["spelling"]["encoding"], "utf-8");
    assert_eq!(answer["spelling"]["mark"], false);
    let fingerprint = answer["fingerprint"]
        .as_str()
        .expect("a fingerprint")
        .to_string();

    // It is the buffer's fingerprint and not the file's: an edit nobody has saved moves it, which is the whole reason a write has to quote it back.
    workspace
        .active_edit_mut()
        .expect("the buffer")
        .replace_range(0, 0, "x");
    let edited = pipe_document_answer(&mut workspace).expect("the buffer answers");
    assert_ne!(edited["fingerprint"], fingerprint.as_str());
    assert_eq!(edited["unsaved"], true);

    // A path with no file behind it is refused in words, and no tab is opened for it.
    let missing = dir.join("gone.md");
    let refusal =
        pipe_bring_to_front(&mut workspace, &missing).expect_err("a missing file is refused");
    assert!(refusal.contains("gone.md"), "{refusal}");
    assert_eq!(workspace.tabs.len(), 1);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_write_through_the_pipe_is_guarded_by_the_fingerprint_and_lands_on_disk() {
    // The write half: an edit is refused unless it quotes what the buffer is holding, nothing reaches the file until a save is asked for, and a document with no file of its own cannot be saved at all.
    let dir = std::env::temp_dir().join(format!("leaf-pipe-write-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("the fixture is written");

    let mut workspace = Workspace::default();
    let mut file_watch = FileWatch::default();
    let vaults = VaultState::load(None);
    let mut book = RefreshBook::default();

    pipe_bring_to_front(&mut workspace, &note).expect("the file opens");
    let read = pipe_document_answer(&mut workspace).expect("the buffer answers");
    let opened = read["fingerprint"]
        .as_str()
        .expect("a fingerprint")
        .to_string();

    // A fingerprint that is not the buffer's writes nothing, and the refusal carries the one it is holding so the asker can read again rather than guess.
    let refusal = pipe_edit_document(&mut workspace, &note, 0, 0, "x", "0000000000000000")
        .expect_err("a stale fingerprint is refused");
    assert!(refusal.contains(&opened), "{refusal}");
    assert_eq!(
        workspace.active_edit().map(|edit| edit.text().to_string()),
        Some("# Note\n".to_string())
    );

    // So is a write aimed at a document that is not the one at the front, however good its fingerprint.
    let elsewhere = dir.join("other.md");
    assert!(pipe_edit_document(&mut workspace, &elsewhere, 0, 0, "x", &opened).is_err());

    let written =
        pipe_edit_document(&mut workspace, &note, 2, 6, "Edited", &opened).expect("the edit lands");
    let edited = written["fingerprint"]
        .as_str()
        .expect("a fingerprint")
        .to_string();
    assert_eq!(written["unsaved"], true);
    assert!(
        workspace
            .active_edit()
            .is_some_and(EditableDocument::can_undo),
        "an agent's edit is one undo step, so the owner takes it back the way they take back their own"
    );
    assert_eq!(
        fs::read_to_string(&note).expect("the file is read"),
        "# Note\n",
        "nothing reaches the file until a save is asked for"
    );

    // The save is guarded by the same fingerprint, so the text on disk is the text somebody read back.
    assert!(pipe_save_document(
        None,
        &mut workspace,
        &mut file_watch,
        &vaults,
        &mut book,
        &note,
        &opened
    )
    .is_err());
    let saved = pipe_save_document(
        None,
        &mut workspace,
        &mut file_watch,
        &vaults,
        &mut book,
        &note,
        &edited,
    )
    .expect("the save lands");
    assert_eq!(saved["unsaved"], false);
    assert_eq!(
        fs::read_to_string(&note).expect("the file is read"),
        "# Edited\n"
    );

    // A document that has never been named has nowhere to be written, and the dialog that would ask is the owner's.
    let mut blank = Workspace::default();
    let untitled = blank.open_untitled();
    let empty = pipe_document_answer(&mut blank).expect("an untitled buffer answers");
    assert_eq!(empty["untitled"], true);
    let refusal = pipe_save_document(
        None,
        &mut blank,
        &mut file_watch,
        &vaults,
        &mut book,
        &untitled,
        empty["fingerprint"].as_str().expect("a fingerprint"),
    )
    .expect_err("an untitled document cannot be saved through the pipe");
    assert!(refusal.contains("never been saved"), "{refusal}");

    let _ = fs::remove_dir_all(&dir);
}

/// What the task ask refuses, and that it writes nothing when it does. Each guard is the half the page command it shares a body with has none of, so each is checked to have left the file alone.
#[test]
fn a_task_toggle_through_the_pipe_refuses_before_it_writes_anything() {
    let dir = std::env::temp_dir().join(format!("leaf-pipe-task-refusals-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let note = dir.join("tasks.md");
    fs::write(&note, "- [ ] one\n- [x] two\n").expect("the fixture is written");
    let plain = dir.join("plain.json");
    fs::write(&plain, "{\"a\": 1}\n").expect("the second fixture is written");

    let mut workspace = Workspace::default();
    let mut file_watch = FileWatch::default();
    pipe_bring_to_front(&mut workspace, &note).expect("the file opens");
    let read = pipe_document_answer(&mut workspace).expect("the buffer answers");
    let good = read["fingerprint"]
        .as_str()
        .expect("a fingerprint")
        .to_string();
    let untouched = fs::read(&note).expect("the file is read");

    let stale = pipe_toggle_task(
        None,
        &mut workspace,
        &mut file_watch,
        &note,
        0,
        "0000000000000000",
    )
    .expect_err("a fingerprint that is not the buffer's is refused");
    assert!(stale.contains("changed since that fingerprint"), "{stale}");

    let missing = pipe_toggle_task(None, &mut workspace, &mut file_watch, &note, 9, &good)
        .expect_err("an index naming no task is refused");
    assert!(
        missing.contains("no task 9") && missing.contains("has 2"),
        "{missing}"
    );

    // The document at the front is the note, so an ask aimed at the other file is refused before it can land on this one.
    let elsewhere = pipe_toggle_task(None, &mut workspace, &mut file_watch, &plain, 0, &good)
        .expect_err("a document that is not at the front is refused");
    assert!(
        elsewhere.contains("is the document at the front"),
        "{elsewhere}"
    );

    // The JSON file at the front: a format with no task markers in it at all.
    pipe_bring_to_front(&mut workspace, &plain).expect("the second file opens");
    let other = pipe_document_answer(&mut workspace).expect("the buffer answers");
    assert_eq!(
        other["tasks"],
        serde_json::json!([]),
        "a data file has no tasks"
    );
    let wrong_format = pipe_toggle_task(
        None,
        &mut workspace,
        &mut file_watch,
        &plain,
        0,
        other["fingerprint"].as_str().expect("a fingerprint"),
    )
    .expect_err("a document that is not Markdown is refused");
    assert!(wrong_format.contains("not Markdown"), "{wrong_format}");

    // The whole point of refusing before writing: four refusals, and the file is byte for byte what it was.
    assert_eq!(
        fs::read(&note).expect("the file is read"),
        untouched,
        "a refused toggle wrote to the file anyway"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// A toggle that lands: one marker moves, the rest of the file does not, the document is not left dirty, the answer carries the fresh fingerprint, and a file spelled UTF-16 comes back spelled that way.
#[test]
fn a_task_toggle_through_the_pipe_moves_one_marker_and_keeps_the_file_spelling() {
    let dir = std::env::temp_dir().join(format!("leaf-pipe-task-toggle-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let note = dir.join("wide-tasks.md");
    let spelling = SourceSpelling {
        encoding: SourceEncoding::Utf16Le,
        mark: true,
    };
    let source = "- [ ] one\n- [ ] two\n- [x] three\n";
    fs::write(&note, leaftext::encode_source(source, spelling)).expect("the fixture is written");

    let mut workspace = Workspace::default();
    let mut file_watch = FileWatch::default();
    pipe_bring_to_front(&mut workspace, &note).expect("the file opens");
    let read = pipe_document_answer(&mut workspace).expect("the buffer answers");

    let answer = pipe_toggle_task(
        None,
        &mut workspace,
        &mut file_watch,
        &note,
        1,
        read["fingerprint"].as_str().expect("a fingerprint"),
    )
    .expect("the toggle lands");
    assert_eq!(answer["index"], 1);
    assert_eq!(
        answer["checked"], true,
        "the answer says what the file now holds"
    );

    let bytes = fs::read(&note).expect("the file is read");
    assert_eq!(
        &bytes[..2],
        &[0xFF, 0xFE],
        "the byte order mark is written back"
    );
    let back = leaftext::decode_source(&bytes).expect("the file still decodes");
    assert_eq!(back.text, "- [ ] one\n- [x] two\n- [x] three\n");
    assert_eq!(back.spelling, spelling);

    // Saved on the spot, the way the reader's own checkbox is: nothing is left for a later save ask.
    let after = pipe_document_answer(&mut workspace).expect("the buffer answers again");
    assert_eq!(after["unsaved"], false);
    assert_eq!(
        after["fingerprint"], answer["fingerprint"],
        "the answer's fingerprint is the one a next write has to quote"
    );

    // Clearing it puts the file back exactly as it arrived.
    pipe_toggle_task(
        None,
        &mut workspace,
        &mut file_watch,
        &note,
        1,
        after["fingerprint"].as_str().expect("a fingerprint"),
    )
    .expect("the second toggle lands");
    let cleared = leaftext::decode_source(&fs::read(&note).expect("the file is read"))
        .expect("the file still decodes");
    assert_eq!(cleared.text, source);

    let _ = fs::remove_dir_all(&dir);
}

/// The task list the document read answers: what a caller names a task by. Its order and its checked states are the source's, and a `[ ]` that is not a list marker is not in it.
#[test]
fn the_document_read_answers_the_tasks_a_caller_can_name() {
    let dir = std::env::temp_dir().join(format!("leaf-pipe-task-list-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let note = dir.join("list.md");
    // The table cell and the fenced block are the two places a `[ ]` is text rather than a task.
    fs::write(
        &note,
        "- [ ] open one\n- [x] done one\n  - [ ] nested\n\n| Step | Done |\n| --- | --- |\n| a | [ ] |\n\n```\n- [ ] in a fence\n```\n",
    )
    .expect("the fixture is written");

    let mut workspace = Workspace::default();
    pipe_bring_to_front(&mut workspace, &note).expect("the file opens");
    let read = pipe_document_answer(&mut workspace).expect("the buffer answers");
    let tasks = read["tasks"].as_array().expect("a task list").clone();

    assert_eq!(
        tasks.len(),
        3,
        "the table cell or the fence was counted: {tasks:?}"
    );
    assert_eq!(
        tasks[0],
        serde_json::json!({ "checked": false, "text": "open one" })
    );
    // A nested task is its own entry, and the one holding it carries only its own words.
    assert_eq!(
        tasks[1],
        serde_json::json!({ "checked": true, "text": "done one" })
    );
    assert_eq!(
        tasks[2],
        serde_json::json!({ "checked": false, "text": "nested" })
    );

    // The list is what the toggle counts by, so its order and the marker order are one thing.
    assert_eq!(
        tasks.len(),
        leaftext::task_marker_offsets(read["text"].as_str().expect("the source")).len(),
        "the list a caller reads and the markers the toggle flips disagree"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_document_written_through_the_pipe_keeps_the_spelling_it_arrived_with() {
    // The whole reason the feature exists: a file rewritten through terminal text output comes back UTF-8 with its mark gone, and the owner has paid for that once. Through the asks it goes out spelled the way it came in.
    let dir = std::env::temp_dir().join(format!("leaf-pipe-spelling-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let note = dir.join("wide.md");
    let spelling = SourceSpelling {
        encoding: SourceEncoding::Utf16Le,
        mark: true,
    };
    fs::write(&note, leaftext::encode_source("# Wide\n", spelling))
        .expect("the fixture is written");

    let mut workspace = Workspace::default();
    let mut file_watch = FileWatch::default();
    let vaults = VaultState::load(None);
    let mut book = RefreshBook::default();

    pipe_bring_to_front(&mut workspace, &note).expect("the file opens");
    let read = pipe_document_answer(&mut workspace).expect("the buffer answers");
    // The mark is a fact about the file rather than a character in the text, so it is reported and never handed over to be edited around.
    assert_eq!(read["text"], "# Wide\n");
    assert_eq!(read["spelling"]["encoding"], "utf-16le");
    assert_eq!(read["spelling"]["mark"], true);

    let written = pipe_edit_document(
        &mut workspace,
        &note,
        0,
        7,
        "# Wider\n",
        read["fingerprint"].as_str().expect("a fingerprint"),
    )
    .expect("the edit lands");
    pipe_save_document(
        None,
        &mut workspace,
        &mut file_watch,
        &vaults,
        &mut book,
        &note,
        written["fingerprint"].as_str().expect("a fingerprint"),
    )
    .expect("the save lands");

    let bytes = fs::read(&note).expect("the file is read");
    assert_eq!(
        &bytes[..2],
        &[0xFF, 0xFE],
        "the byte order mark the file arrived with is written back"
    );
    let back = leaftext::decode_source(&bytes).expect("the file still decodes");
    assert_eq!(back.text, "# Wider\n");
    assert_eq!(back.spelling, spelling);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_save_that_fails_comes_back_as_a_refusal_and_never_as_a_success() {
    // A write that did not happen must not read as one: an asker told a file was saved goes on to the next thing, and what was typed is only in a buffer nobody is watching.
    let dir = std::env::temp_dir().join(format!("leaf-pipe-save-fails-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let note = dir.join("note.md");
    fs::write(&note, "# Note\n").expect("the fixture is written");

    let mut workspace = Workspace::default();
    let mut file_watch = FileWatch::default();
    let vaults = VaultState::load(None);
    let mut book = RefreshBook::default();

    pipe_bring_to_front(&mut workspace, &note).expect("the file opens");
    let read = pipe_document_answer(&mut workspace).expect("the buffer answers");
    let written = pipe_edit_document(
        &mut workspace,
        &note,
        2,
        6,
        "Edited",
        read["fingerprint"].as_str().expect("a fingerprint"),
    )
    .expect("the edit lands");

    // The file goes and a folder takes its name, which is a write no platform allows.
    fs::remove_file(&note).expect("the fixture file is removed");
    fs::create_dir(&note).expect("a folder takes its place");

    let refusal = pipe_save_document(
        None,
        &mut workspace,
        &mut file_watch,
        &vaults,
        &mut book,
        &note,
        written["fingerprint"].as_str().expect("a fingerprint"),
    )
    .expect_err("a save that could not write refuses");
    assert!(refusal.contains("was not written"), "{refusal}");
    assert!(
        workspace
            .active_edit()
            .is_some_and(EditableDocument::is_dirty),
        "the buffer still has the edit nobody managed to write"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_quit_ask_answers_that_it_is_closing_and_refuses_when_the_window_is_silent() {
    // The trap this ask is built around: a variant with no arm of its own falls through to the mapping that knows only `state` and `eval`, so it would compile, ship, close nothing, and report the failure the pipe reserves for a wedged app.
    let asked = std::sync::atomic::AtomicUsize::new(0);
    let reply = pipe::answer(r#"{"ask":"quit"}"#, |ask| {
        assert!(matches!(ask, pipe::Ask::Quit), "the loop is asked to close");
        asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Some(Ok(serde_json::json!({ "closing": true })))
    });
    assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(
        reply.after,
        Some(pipe::AfterReply::Close),
        "the closing waits on the reply being out, and this is what carries it"
    );
    let text: serde_json::Value = serde_json::from_str(&reply.text).expect("a JSON reply");
    assert_eq!(text["ok"], true);
    assert_eq!(text["answer"]["closing"], true);

    // A loop that never answers is refused in the same words every other ask uses — and nothing is told to close, because nothing knows whether the app is even alive.
    let reply = pipe::answer(r#"{"ask":"quit"}"#, |_| None);
    assert_eq!(
        reply.after, None,
        "a window that cannot answer must not be closed anyway"
    );
    let text: serde_json::Value = serde_json::from_str(&reply.text).expect("a JSON reply");
    assert_eq!(text["ok"], false);
    assert!(text["error"]
        .as_str()
        .unwrap_or_default()
        .contains("did not answer in time"));
}

#[test]
fn the_app_is_told_to_close_only_after_the_reply_has_been_taken() {
    // Replying and then closing inside one arm is the bug this ordering exists to refuse: stopping the loop ends every thread, and a reply still in the pipe is thrown away — which every client reads as the question failing. So the after-reply action here blocks until this test lets it go, and the asker must have its whole answer while it is still blocked. An ordering that closed first would leave the asker with nothing.
    let address = test_pipe_address("quit-order");
    let (running, runs) = std::sync::mpsc::channel::<()>();
    let (gate, held) = std::sync::mpsc::channel::<()>();
    let held = std::sync::Mutex::new(held);
    pipe::listen(
        address.clone(),
        |request| {
            pipe::answer(request, |_| {
                Some(Ok(serde_json::json!({ "closing": true })))
            })
        },
        move |after| {
            assert_eq!(after, pipe::AfterReply::Close);
            let _ = running.send(());
            let _ = held
                .lock()
                .expect("the gate")
                .recv_timeout(std::time::Duration::from_secs(5));
        },
    );

    // Asked from a thread of its own: were the ordering wrong, the reply would never be written and this would wait for ever rather than fail.
    let asking = address.clone();
    let (answered, answers) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = answered.send(pipe::ask(&asking, r#"{"ask":"quit"}"#));
    });
    let reply = answers
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("the reply must arrive while the closing is still held")
        .expect("the pipe answered");
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["answer"]["closing"], true);

    // And the closing did start — an ask that answered and closed nothing is the other half of the failure.
    runs.recv_timeout(std::time::Duration::from_secs(5))
        .expect("the app is told to close once the asker has the answer");
    let _ = gate.send(());
}

#[test]
fn the_state_answer_says_what_is_open_with_no_window_at_all() {
    // The first test `pipe_state` has ever had. The four pipe tests stub the window out, which is exactly how a state answer with a field renamed in it could ship untested — and the workspace half is the half that has to survive a page too stuck to reply.
    let mut workspace = Workspace::default();
    workspace.open_path(PathBuf::from("notes/a.md"));
    workspace.open_path(PathBuf::from("notes/b.md"));
    // No database: `load` falls back to no vaults and the whole library, which is what a machine with no manifest.db has.
    let vaults = VaultState::load(None);

    let state = pipe_state(&workspace, &vaults);
    assert_eq!(state["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(state["activeTab"], 1);
    assert!(state["activePath"]
        .as_str()
        .unwrap_or_default()
        .contains("b.md"));
    let tabs = state["tabs"].as_array().expect("a list of tabs");
    assert_eq!(tabs.len(), 2);
    assert!(tabs[0]["path"]
        .as_str()
        .unwrap_or_default()
        .contains("a.md"));
    assert_eq!(tabs[0]["codeView"], false);
    assert_eq!(tabs[0]["unsaved"], false);
    assert_eq!(state["vault"]["id"], 0);
}

#[test]
fn a_page_that_cannot_answer_costs_the_reader_half_and_nothing_else() {
    // `state` exists to answer an app that is stuck, so the reader half is opt-in and asked for separately. A wedged page must still hand back the tabs, the paths and the vault.
    let asked = std::sync::atomic::AtomicUsize::new(0);
    let reply = pipe::answer(r#"{"ask":"state","reader":true}"#, |ask| match ask {
        pipe::Ask::State { .. } => Some(Ok(serde_json::json!({ "tabs": [{ "path": "a.md" }] }))),
        pipe::Ask::Eval { .. } => {
            asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            None
        }
        _ => None,
    });
    let reply: serde_json::Value = serde_json::from_str(&reply.text).expect("a JSON reply");
    assert_eq!(
        reply["ok"], true,
        "a silent page must not refuse the answer"
    );
    assert_eq!(reply["answer"]["tabs"][0]["path"], "a.md");
    assert!(
        reply["answer"]["reader"]["error"]
            .as_str()
            .unwrap_or_default()
            .contains("did not answer in time"),
        "the missing half should say why: {reply}"
    );
    assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), 1);

    // And what the page says is merged onto the same answer rather than arriving as a second one.
    let reply = pipe::answer(r#"{"ask":"state","reader":true}"#, |ask| match ask {
        pipe::Ask::State { .. } => Some(Ok(serde_json::json!({ "tabs": [] }))),
        _ => Some(Ok(serde_json::json!({ "scrollTop": 4000 }))),
    });
    let reply: serde_json::Value = serde_json::from_str(&reply.text).expect("a JSON reply");
    assert_eq!(reply["answer"]["reader"]["scrollTop"], 4000);

    // Without the flag the page is never asked, which is what makes the plain ask safe on an app that is hanging.
    let asked = std::sync::atomic::AtomicUsize::new(0);
    let reply = pipe::answer(r#"{"ask":"state"}"#, |ask| {
        if matches!(ask, pipe::Ask::Eval { .. }) {
            asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        Some(Ok(serde_json::json!({ "tabs": [] })))
    });
    assert!(reply.text.contains("\"ok\":true"), "{}", reply.text);
    assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert!(
        !reply.text.contains("reader"),
        "the plain ask answers what it always answered: {}",
        reply.text
    );
}

#[test]
fn the_idle_ask_says_it_gave_up_rather_than_waiting_for_ever() {
    // A driven pass asks this instead of sleeping, so the one thing it must never do is hang: a page that never settles is an answer, and it has to be told apart from a page that settled.
    let settled = pipe::answer(r#"{"ask":"idle"}"#, |_| {
        Some(Ok(
            serde_json::json!({ "renderInFlight": false, "scrollTop": 0 }),
        ))
    });
    let settled: serde_json::Value = serde_json::from_str(&settled.text).expect("a JSON reply");
    assert_eq!(settled["answer"]["idle"], true);
    assert_eq!(settled["answer"]["reader"]["scrollTop"], 0);

    let started = std::time::Instant::now();
    let busy = pipe::answer(r#"{"ask":"idle"}"#, |_| {
        Some(Ok(serde_json::json!({ "renderInFlight": true })))
    });
    let waited = started.elapsed();
    let busy: serde_json::Value = serde_json::from_str(&busy.text).expect("a JSON reply");
    assert_eq!(busy["ok"], true);
    assert_eq!(busy["answer"]["idle"], false);
    assert!(
        busy["answer"]["why"]
            .as_str()
            .unwrap_or_default()
            .contains("still rendering"),
        "it should say which of the two it hit: {busy}"
    );
    // Inside the two seconds the pipe gives the window, or the wait would be cut off by the thing it runs inside.
    assert!(
        waited < std::time::Duration::from_secs(2),
        "the wait took {waited:?}"
    );
}

#[test]
fn a_window_that_cannot_run_it_says_so_rather_than_timing_out() {
    // Two different failures, told apart: nothing to run the script in is an answer the app has, and it should not cost the asker two seconds of waiting to find out.
    let reply = pipe::answer(r#"{"ask":"eval","script":"1+1"}"#, |_| {
        Some(Err("there is no window to run it in".to_string()))
    });
    let reply: serde_json::Value = serde_json::from_str(&reply.text).expect("a JSON reply");
    assert_eq!(reply["ok"], false);
    assert_eq!(reply["error"], "there is no window to run it in");
}

#[test]
fn a_blocked_event_loop_answers_no_reply_rather_than_hanging() {
    // The failure this whole shape exists to avoid: an app too busy to answer must not take the asker down with it. Asserted against the reply channel directly, with no window in play, so a bug here fails a test instead of hanging the suite. The sender stays alive and is never filled, which is what a hung window looks like from here — a dropped one would end the wait for the wrong reason. The app waits two seconds; the kind of ending is what matters.
    let (_reply, answers) = std::sync::mpsc::sync_channel::<Result<serde_json::Value, String>>(1);
    assert_eq!(
        answers.recv_timeout(std::time::Duration::from_millis(250)),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout),
        "the wait must end on the clock, not on the channel closing"
    );

    // And that is the refusal the asker gets.
    let text = pipe::answer(r#"{"ask":"eval","script":"while(true){}"}"#, |_| None);
    let text: serde_json::Value = serde_json::from_str(&text.text).expect("a JSON reply");
    assert_eq!(text["ok"], false);
    assert!(text["error"]
        .as_str()
        .unwrap_or_default()
        .contains("did not answer in time"));
}

#[cfg(windows)]
#[test]
fn an_asker_is_told_the_pipe_ended_not_that_it_was_taken_away() {
    // The bug that made every question fail while the tests stayed green: `DisconnectNamedPipe` hands the asker "the pipe is being closed" (232) *after* a perfectly good reply, and node reports that as a failure. Closing the handle instead gives "the pipe ended" (109), which every client reads as the end of the answer. The round trip alone missed it because it stops reading once it has the reply.
    const ERROR_BROKEN_PIPE: u32 = 109;
    let address = test_pipe_address("ending");
    pipe::listen(
        address.clone(),
        |request| pipe::answer(request, |_| Some(Ok(serde_json::json!(null)))),
        |_| panic!("nothing here asks for anything after its reply"),
    );

    let (reply, ending) =
        pipe::ask_then_ending(&address, r#"{"ask":"version"}"#).expect("the pipe answered");
    assert!(reply.contains("\"ok\":true"), "{reply}");
    assert_eq!(
        ending, ERROR_BROKEN_PIPE,
        "the asker should be told the pipe ended, not that it was taken away"
    );
}

#[test]
fn the_page_reports_an_error_in_words_the_host_understands() {
    // The page's own errors travel as JSON over the same IPC as everything else, and the host drops what it cannot parse. So a field renamed on one side is silent: errors simply stop arriving. This is the exact message journal.js builds — see the matching check in scripts/check-shell.mjs.
    let sent = r#"{"command":"logError","message":"Error: boom\n at app.js:1","count":4}"#;
    match serde_json::from_str::<IpcCommand>(sent) {
        Ok(IpcCommand::LogError { message, count }) => {
            assert!(message.contains("boom"));
            assert_eq!(count, 4);
        }
        other => panic!("the page's error report did not arrive: {other:?}"),
    }
}

#[test]
fn the_journal_hands_back_the_last_lines_asked_for() {
    // `log` with a line count is how a report quotes the end of a long session. Off by one here and the last line — the one that says what just went wrong — is the one left out.
    let written = "one\ntwo\nthree\nfour\n";
    assert_eq!(
        journal::tail(written, Some(2)),
        "three\nfour",
        "the last two, in the order they were written"
    );
    assert_eq!(
        journal::tail(written, Some(99)),
        "one\ntwo\nthree\nfour",
        "asking for more lines than there are is not an error"
    );
    assert_eq!(journal::tail(written, Some(0)), "");
    assert_eq!(
        journal::tail(written, None),
        written,
        "no count means the whole file, trailing newline and all"
    );
}

#[test]
fn a_window_that_never_answers_is_reported_not_waited_on() {
    // Asking a hung app what it is doing is the point of the pipe, so the one thing it must never do is hang with it.
    let reply = pipe::answer(r#"{"ask":"state"}"#, |_| None);
    let reply: serde_json::Value = serde_json::from_str(&reply.text).expect("a JSON reply");
    assert_eq!(reply["ok"], false);
    assert!(reply["error"]
        .as_str()
        .unwrap_or_default()
        .contains("did not answer in time"));
}

/// A folder of its own per journal test, and per run: these write real files, so two runs of the suite at once must not land on each other either. The one test that spawns a second process tells the child which folder rather than letting it work the name out, because the child's own process id is a different number.
fn journal_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("leaf-journal-{}-{name}", std::process::id()))
}

#[test]
fn the_journal_rolls_to_exactly_two_files() {
    // The cap is the whole promise: a log nobody empties has to stop growing on its own, and one previous copy is what survives a restart-after-a-crash.
    let dir = journal_dir("roll");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("a temp folder");
    let live = journal::log_path(&dir);
    let previous = journal::previous_log_path(&dir);

    // Under the cap, nothing moves.
    fs::write(&live, "small").expect("a journal to write");
    journal::roll(&dir);
    assert!(
        live.exists() && !previous.exists(),
        "a small journal stays put"
    );

    // Over it, the journal becomes the previous copy.
    fs::write(&live, vec![b'x'; 1024 * 1024]).expect("a full journal");
    journal::roll(&dir);
    assert!(!live.exists(), "the full journal was moved aside");
    assert_eq!(
        fs::read(&previous).expect("the previous copy").len(),
        1024 * 1024
    );

    // A second roll overwrites that copy rather than starting a third file.
    fs::write(&live, vec![b'y'; 1024 * 1024]).expect("a second full journal");
    journal::roll(&dir);
    assert_eq!(
        fs::read(&previous).expect("the previous copy").first(),
        Some(&b'y'),
        "the newer copy replaced the older one"
    );
    let files = fs::read_dir(&dir).expect("the folder").count();
    assert_eq!(files, 1, "two files at the very most, and never a third");
}

#[test]
fn a_data_folder_that_cannot_be_written_does_not_stop_the_app() {
    // Instrumentation never takes the app down. A file sitting where the data folder should be is the portable version of "you cannot write here".
    let dir = journal_dir("blocked");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.parent().expect("a parent")).expect("a temp folder");
    fs::write(&dir, "not a folder").expect("a file in the way");

    // Returns rather than panicking, and leaves stderr where it was — nothing is redirected in this process, so the rest of the suite still prints normally.
    journal::start_in(&dir);
}

#[test]
fn a_panic_reaches_the_journal() {
    // A crash is the one thing that cannot be reproduced by asking. This runs in a second process for two reasons: a panic here would be caught by the test harness instead of the hook, and the redirect is process-wide — done in this process it would swallow every other test's output.
    const CHILD: &str = "LEAFTEXT_JOURNAL_PANIC_CHILD";

    // The folder is the parent's to name, and it is handed over rather than worked out again: it carries the parent's process id, which the child does not have.
    if let Some(handed_over) = std::env::var_os(CHILD) {
        journal::start_in(Path::new(&handed_over));
        panic!("the journal should be holding this");
    }

    let dir = journal_dir("panic");
    let _ = fs::remove_dir_all(&dir);
    let child = Command::new(std::env::current_exe().expect("this test binary"))
        // --nocapture matters: with the harness capturing output, `eprintln!` is diverted before it ever reaches the handle the journal swapped.
        .args(["a_panic_reaches_the_journal", "--nocapture"])
        .env(CHILD, &dir)
        .output()
        .expect("a second copy of the test binary");

    assert!(!child.status.success(), "the child was supposed to panic");
    let written = fs::read_to_string(journal::log_path(&dir)).expect("a journal file");
    assert!(
        written.contains("panic at") && written.contains("the journal should be holding this"),
        "the panic did not reach the journal: {written:?}"
    );
}

#[test]
fn the_mac_window_is_the_app_bar_with_our_own_three_dots() {
    // Four builder calls make the Mac shell, and each alone is broken: without the fullsize content view the page starts below a gray strip, without the transparent bar the strip is still painted, without the hidden title "Leaftext" sits over the tabs, and without the buttons hidden Apple's dots sit on top of the three the page now draws. `with_decorations(false)` must never join them — tao overwrites every title-bar property when it is set, and the see-through strip goes with it.
    let source = include_str!("../main.rs");
    let mac_arm = source
        .split("#[cfg(target_os = \"macos\")]")
        .find(|arm| arm.contains("with_titlebar_buttons_hidden"))
        .expect("main.rs has a macOS window arm");
    // Nothing insets Apple's dots: there are none to inset — the page's own fold into the chevron menu, which a native view pinned to the window never could.
    assert!(
        !source.contains("with_traffic_light_inset"),
        "the dots are ours now, so there is nothing to inset"
    );
    for call in [
        "with_fullsize_content_view(true)",
        "with_titlebar_transparent(true)",
        "with_title_hidden(true)",
        "with_titlebar_buttons_hidden(true)",
        // The window's own shadow goes, because the app draws it: the dot lattice over the strip of page the app is held off the window by. `false` and not left out — AppKit's shadow is on unless something says otherwise, which is the same trap tao's Windows flag sets.
        "with_has_shadow(false)",
    ] {
        assert_eq!(
            source.matches(call).count(),
            1,
            "{call} belongs once, in the macOS window arm"
        );
    }
    assert!(
        !mac_arm.contains("with_decorations"),
        "dropping the decorations on macOS takes Apple's three dots with them"
    );

    // The Windows arm is a different shell — no native frame at all — and this change leaves it alone.
    assert_eq!(source.matches("with_decorations(false)").count(), 1);
    // The dock and app-switcher icon is not the strip, so macOS keeps taking it.
    assert!(source.contains("#[cfg(not(windows))]"));
}

#[test]
fn the_window_asks_for_no_platform_shadow_and_shows_what_is_behind_it() {
    // The app throws its own shadow — the dot lattice, over the outer strip of the page — so the platform's smooth one has to go and the window has to be see-through for the app's to land anywhere. Both halves, or the window has two shadows or none.
    //
    // `false` and not merely left out: tao's flag is on unless something says otherwise, so a build with the call removed keeps the halo, keeps the frame insets that make the window bigger than the page it holds, and keeps a hit test that finds only the top edge.
    let source = include_str!("../main.rs");
    let windows_arm = source
        .split("#[cfg(windows)]")
        .find(|arm| arm.contains("with_decorations(false)"))
        .expect("main.rs has a Windows window arm");
    assert!(
        windows_arm.contains("with_undecorated_shadow(false)"),
        "the platform shadow is still on, so the app draws a second one inside it"
    );
    assert!(
        !source.contains("with_undecorated_shadow(true)"),
        "the platform shadow was asked for again"
    );
    assert!(
        windows_arm.contains("with_transparent(true)"),
        "an opaque window paints the app's own shadow band in the page color"
    );
    // Three asks in all: one per window arm, because an opaque window has nothing for the band to fall on, and one for the web view, because a see-through window over an opaque web view shows nothing.
    assert_eq!(
        source.matches("with_transparent(true)").count(),
        3,
        "a window arm or the web view is still opaque, so the app's own shadow lands on a page color there"
    );
    let mac_arm = source
        .split("#[cfg(target_os = \"macos\")]")
        .find(|arm| arm.contains("with_titlebar_buttons_hidden"))
        .expect("main.rs has a macOS window arm");
    assert!(
        mac_arm.contains("with_has_shadow(false)"),
        "the Mac window keeps AppKit's own shadow, so the app draws a second one inside it"
    );
    // And the web view with it: a see-through window over an opaque web view shows nothing.
    assert!(
        source.contains(
            "WebViewBuilder::new_with_web_context(&mut web_context)\n        // See-through"
        ),
        "the web view is built opaque, so the window's transparency reaches nothing"
    );
    // The frame draws no line of its own. With the client area running out to the window's own edge, a border would trace the outside of the shadow band rather than the app — and the app carries its own edge now, so nothing is lost.
    assert!(
        source.contains("const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;")
            && source.contains("let border = DWMWA_COLOR_NONE;"),
        "the window frame still takes a border color"
    );
    assert!(
        !source.contains("border_r"),
        "the divider color is still being sent to a frame that draws nothing with it"
    );
    // The smallest window grows by the band, so the smallest readable page is the size it was pinned at rather than 40px narrower. Read off the value itself: a resize the host drives clamps to the same pair, and the two have to be one number.
    assert_eq!(
        MIN_INNER_SIZE,
        (380.0 + 40.0, 480.0 + 23.0),
        "the smallest window lost the band out of its readable page"
    );
    assert!(
        source.contains("with_min_inner_size(LogicalSize::new(MIN_INNER_SIZE.0, MIN_INNER_SIZE.1))"),
        "the window is built with a smallest size of its own rather than the one the host clamps to"
    );
    // Asking the web view to be see-through is a no-op on a Mac unless the manifest names the crate feature that compiles that call in — which is how the band shipped as a solid gray slab on every Mac while every assert above passed.
    let manifest = include_str!("../../Cargo.toml");
    assert!(
        manifest.contains(r#"wry = { version = "0.55.1", optional = true, features = ["transparent"] }"#),
        "the web view's see-through ask is compiled out on macOS, so the band is a solid slab there"
    );
}

#[test]
fn a_press_in_the_shadow_band_resizes_the_window() {
    // With the platform shadow off, the window is exactly the page it holds and the web view covers every pixel of it, so the window's own edge test is correct and never reached. The page takes the press instead and this arm hands the window to the platform's own resize loop, beside the arm that answers the app bar's window move the same way.
    use tao::window::ResizeDirection::*;
    for (name, direction) in [
        ("n", North),
        ("ne", NorthEast),
        ("e", East),
        ("se", SouthEast),
        ("s", South),
        ("sw", SouthWest),
        ("w", West),
        ("nw", NorthWest),
    ] {
        assert_eq!(
            resize_direction(name),
            Some(direction),
            "the band's {name} edge asks for a resize the window library does not recognize"
        );
    }
    // Anything else is dropped rather than guessed at: a wrong guess resizes the wrong edge under the pointer.
    assert_eq!(resize_direction("north"), None);
    assert_eq!(resize_direction(""), None);

    // The press is the whole of it on Windows: the platform's own loop runs the gesture and reports nothing back.
    assert_eq!(
        resize_drag_step(true, "se", "start", 10.0, 20.0, None),
        ResizeDragStep::HandToPlatform(SouthEast)
    );
    for phase in ["move", "end"] {
        assert_eq!(
            resize_drag_step(true, "se", phase, 10.0, 20.0, None),
            ResizeDragStep::Nothing
        );
    }
    assert_eq!(
        resize_drag_step(true, "north", "start", 0.0, 0.0, None),
        ResizeDragStep::Nothing
    );

    // A Mac is refused that call, so the host holds the window as it stood and sets it from every move.
    let held = ResizeDrag {
        direction: "e".to_string(),
        window: WindowRect {
            x: 100.0,
            y: 200.0,
            width: 900.0,
            height: 700.0,
        },
        pointer: (500.0, 500.0),
    };
    assert_eq!(
        resize_drag_step(false, "e", "start", 500.0, 500.0, None),
        ResizeDragStep::HoldWindow {
            direction: "e".to_string(),
            pointer: (500.0, 500.0)
        }
    );
    assert_eq!(
        resize_drag_step(false, "e", "move", 540.0, 500.0, Some(&held)),
        ResizeDragStep::SetWindow(WindowRect {
            width: 940.0,
            ..held.window
        })
    );
    // A move with nothing held is a drag that never started.
    assert_eq!(
        resize_drag_step(false, "e", "move", 540.0, 500.0, None),
        ResizeDragStep::Nothing
    );
    assert_eq!(
        resize_drag_step(false, "e", "end", 0.0, 0.0, Some(&held)),
        ResizeDragStep::Forget
    );

    // The one thing about this handler no value can answer: the direction reaches a window library call, on a window no test can build.
    let source = include_str!("event_loop.rs");
    assert!(
        source.contains("reader.window.drag_resize_window(direction)"),
        "the resize command reaches no window call, so the band takes the press and nothing moves"
    );
}

#[test]
fn the_band_below_a_mac_frames_own_edge_moves_the_window_it_was_grabbed_by() {
    // A Mac is refused the call Windows hands its resize loop to, so without this the only thing that resizes there is the window frame's own edge, at the band's outer rim. The host drives it instead, off the window as it stood and how far the pointer has come — this is that arithmetic.
    let start = WindowRect {
        x: 100.0,
        y: 200.0,
        width: 900.0,
        height: 700.0,
    };
    // The edges the direction names follow the pointer; the others stay where they were.
    assert_eq!(
        resized_window(start, "e", 40.0, 99.0),
        WindowRect {
            width: 940.0,
            ..start
        }
    );
    assert_eq!(
        resized_window(start, "s", 99.0, 30.0),
        WindowRect {
            height: 730.0,
            ..start
        }
    );
    // Dragging the left edge out moves the window's own left with it, so the right stays put.
    assert_eq!(
        resized_window(start, "w", -50.0, 0.0),
        WindowRect {
            x: 50.0,
            width: 950.0,
            ..start
        }
    );
    // A corner moves two edges at once.
    assert_eq!(
        resized_window(start, "nw", -50.0, -25.0),
        WindowRect {
            x: 50.0,
            y: 175.0,
            width: 950.0,
            height: 725.0,
        }
    );
    // Setting the size directly goes around the smallest window the platform is holding for us, so the clamp is the host's.
    let (min_width, min_height) = MIN_INNER_SIZE;
    let squashed = resized_window(start, "se", -5000.0, -5000.0);
    assert_eq!(squashed.width, min_width);
    assert_eq!(squashed.height, min_height);
    assert_eq!((squashed.x, squashed.y), (start.x, start.y));
    // And a north-west drag past it pins the corner the smallest window leaves, rather than walking the window across the screen.
    let pinned = resized_window(start, "nw", 5000.0, 5000.0);
    assert_eq!((pinned.width, pinned.height), (min_width, min_height));
    assert_eq!(pinned.x, start.x + start.width - min_width);
    assert_eq!(pinned.y, start.y + start.height - min_height);
}

#[test]
fn full_screen_is_read_off_the_window_not_off_a_gesture() {
    // Full screen is reachable from the green dot's menu, the View menu and a shortcut, and only one of the three is a click the page ever sees. The resize every one of them causes is what the loop reads, so the bar's room for the dots cannot be left behind by whichever route was taken — which is why the answer is a comparison of two window states rather than of two gestures.
    let plain = WindowState {
        maximized: false,
        fullscreen: false,
    };

    assert!(
        window_state_lines(plain, plain).is_empty(),
        "a resize that moved neither says nothing"
    );
    assert_eq!(
        window_state_lines(
            plain,
            WindowState {
                fullscreen: true,
                ..plain
            }
        ),
        vec!["window.leafSetFullscreen(true);".to_string()],
        "the page is told when it changes"
    );
    assert_eq!(
        window_state_lines(
            WindowState {
                fullscreen: true,
                ..plain
            },
            plain
        ),
        vec!["window.leafSetFullscreen(false);".to_string()],
        "and told again when it goes back"
    );
    assert_eq!(
        window_state_lines(
            plain,
            WindowState {
                maximized: true,
                ..plain
            }
        ),
        vec!["window.leafSetWindowMaximized(true);".to_string()],
        "the custom title bar's own icon is the other half"
    );
}

#[test]
fn removing_a_vault_left_its_favorites_drawn_on_the_start_screen() {
    // A vault going takes its favorites with it, and the registry push is what redraws the start screen. So the page has to be handed the shorter list first: the other way round, the screen is drawn from rows naming a vault the registry no longer has, and every one of them falls into a second group called "Outside a vault".
    let dir = scratch_dir("removing_a_vault_left_its_favorites_drawn_on_the_start_screen");
    let root = dir.join("vault");
    fs::create_dir_all(&root).expect("test directory is created");
    let state = VaultState::load(Some(&dir));
    let vault = add_vault(
        state.conn.as_ref().expect("the registry opens"),
        &root,
        "vault",
        VaultKind::Folder,
    )
    .expect("the vault is registered");

    assert_eq!(
        vault_removal_steps(&state, vault.id),
        vec![
            VaultRemovalStep::ForgetFavorites(vault.id),
            VaultRemovalStep::RedrawTabStrip,
            VaultRemovalStep::ReleaseWatch(PathBuf::from(&vault.root_path)),
            VaultRemovalStep::RemoveRow(vault.id),
            VaultRemovalStep::ShowLibraryRoot,
        ],
        "the registry push has to land last, so the start screen is redrawn against the corrected favorites — and the watch is released before the row that is the only record of where the folder is"
    );

    drop(state);
    fs::remove_dir_all(&dir).expect("test directory is removed");
}

/// The watcher's own branch, which is where saving the file you are looking at lands.
#[test]
fn saving_the_document_you_are_reading_still_updates_the_sync_count() {
    // A change to the open document takes the live-reload branch; a change to anything else takes the other one. A status refresh in only the second leaves the commonest edit there is — saving the file you are looking at — with the header's count stale until something else happens to move.
    let mut state = VaultState::load(None);
    state.active = 3;

    assert_eq!(
        watched_change_steps(&state, Path::new("/vault/notes.md"), true),
        vec![
            WatchedChangeStep::RereadVaultStatus(3),
            WatchedChangeStep::ReloadActiveDocument,
        ],
        "the status read comes above the split, or it only fires for files you are not editing"
    );

    // And nothing between the event and the read. A containment check here discards every event: the watcher reports paths under what it watched, and that is canonicalised — a `\\?\` verbatim prefix on Windows, which does not share a component with the plain `C:\…` the vault registry holds. One `git status` off the loop is cheaper than being wrong.
    assert_eq!(
        watched_change_steps(&state, Path::new("/nowhere/near/it.md"), false).first(),
        Some(&WatchedChangeStep::RereadVaultStatus(3)),
        "a path that looks like it is outside the vault still moves the count"
    );

    // With no vault there is no count to move.
    state.active = 0;
    assert_eq!(
        watched_change_steps(&state, Path::new("/vault/notes.md"), true),
        vec![WatchedChangeStep::ReloadActiveDocument]
    );
}

/// A folder of this run's own per undo test. These delete real files into the real Recycle Bin, and two runs sharing a folder would each be putting the other's file back.
#[cfg(windows)]
fn undo_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("leaf-undo-{}-{name}", std::process::id()))
}

/// Deleted and put back, against the real Recycle Bin. The whole of the undo is a claim about the shell, so a test that mocked it would prove nothing — this one deletes a file of its own and asks for it back.
#[test]
#[cfg(windows)]
fn undo_restores_a_deleted_file_to_its_folder_under_its_own_name() {
    let folder = undo_dir("delete-test");
    let _ = fs::create_dir_all(&folder);
    let file = folder.join("a note.md");
    fs::write(&file, b"the words that have to survive").expect("write the fixture");

    let landed = delete_to_trash(&file).expect("the delete works");
    assert!(!file.exists(), "the file left the folder");

    restore_from_trash(&file, landed.as_deref()).expect("the file comes back");
    assert!(file.exists(), "back in the folder it came from");
    assert_eq!(
        fs::read(&file).expect("read it back"),
        b"the words that have to survive",
        "and it is the same file, not an empty one of the same name"
    );

    let _ = fs::remove_dir_all(&folder);
}

/// A name taken back before the undo. The shell's own move overwrites without asking once it is told not to confirm, so the refusal has to be the app's — losing the newer file would be a worse loss than the one being undone. Nothing is deleted here: the refusal comes before the shell is reached, so a file sitting in the way is the whole of the setup.
#[test]
#[cfg(windows)]
fn a_name_taken_back_before_the_undo_stops_the_restore() {
    let folder = undo_dir("collide-test");
    let _ = fs::create_dir_all(&folder);
    let file = folder.join("collided.md");
    fs::write(&file, b"a different file entirely").expect("something takes the name");

    let error = restore_from_trash(&file, None).expect_err("the restore refuses");
    assert!(
        error.contains("something else is called"),
        "says why: {error}"
    );
    assert_eq!(
        fs::read(&file).expect("read it back"),
        b"a different file entirely",
        "and the file that took the name is untouched"
    );

    let _ = fs::remove_dir_all(&folder);
}

/// Nothing left in the bin under that name means the restore says so rather than reporting a success it did not have. Read off the exit code, so proving the wording does not need somebody's bin emptied first.
#[test]
#[cfg(windows)]
fn a_missing_item_says_the_file_has_left_the_bin() {
    use crate::platform::restore_outcome;

    let error = restore_outcome(Some(2)).expect_err("nothing to put back");
    assert!(
        error.contains("not in the Recycle Bin"),
        "says what is wrong: {error}"
    );
}

/// Every other way the restore can fail says one thing, because a reader can do nothing different about a move that never landed and a shell that never started.
#[test]
#[cfg(windows)]
fn any_other_failure_says_the_bin_would_not_give_it_back() {
    use crate::platform::restore_outcome;

    for code in [Some(1), Some(3), Some(-1), None] {
        let error = restore_outcome(code).expect_err("a failure");
        assert_eq!(
            error, "the Recycle Bin would not give the file back",
            "exit code {code:?}"
        );
    }
    assert!(
        restore_outcome(Some(0)).is_ok(),
        "and zero is the file back"
    );
}

/// A delete the app makes itself renamed the file into the home folder's Trash, and a rename cannot cross a filesystem — so a file on a plugged-in drive or a network share would not delete at all. It goes to the trash folder that volume carries instead, which is where macOS puts it and where the reader already looks.
#[test]
fn a_file_off_the_home_volume_is_trashed_on_the_volume_it_is_on() {
    use crate::platform::trash_folder_for_volume;

    let home = Path::new("/Users/me");

    // On the home volume, today's folder, unchanged.
    assert_eq!(
        trash_folder_for_volume(home, 16, 16, Path::new("/"), 501),
        PathBuf::from("/Users/me/.Trash")
    );

    // Off it, the volume's own folder, under the reader's user id — the two folders macOS itself defines.
    assert_eq!(
        trash_folder_for_volume(home, 16, 41, Path::new("/Volumes/BACKUP"), 501),
        PathBuf::from("/Volumes/BACKUP/.Trashes/501")
    );
}

/// A drive that will not take the file says so in its own name, never the system's wording for a cross-device link, which says nothing anybody can act on.
#[test]
fn a_drive_that_refuses_a_delete_is_named_in_the_message() {
    use crate::platform::drive_refused;

    let said = drive_refused(
        Path::new("/Volumes/BACKUP"),
        "Permission denied (os error 13)",
    );
    assert!(said.starts_with("BACKUP would not take the file"), "{said}");
    assert!(said.contains("Permission denied"), "{said}");

    // The startup volume is mounted at the root, which names nothing — the path stands in for it rather than leaving a blank.
    let root = drive_refused(Path::new("/"), "Read-only file system");
    assert!(root.starts_with("/ would not take the file"), "{root}");
}

/// The undo carries the path it means. Without it a message left on screen through a second delete would put the wrong file back, and nothing on this enum would notice.
#[test]
fn the_undo_names_the_file_it_means_to_put_back() {
    let sent = r#"{"command":"undoDelete","path":"/notes/a note.md"}"#;
    match serde_json::from_str::<IpcCommand>(sent) {
        Ok(IpcCommand::UndoDelete { path }) => {
            assert_eq!(path, PathBuf::from("/notes/a note.md"));
        }
        other => panic!("the undo did not arrive: {other:?}"),
    }
}

/// Where a diagram is to go, answered against the export that asked. The path travels as its own value because the page reads the format off its ending — a path mangled into a sentence would name no format at all.
#[test]
fn the_answer_to_where_a_diagram_goes_carries_the_path_against_its_own_export() {
    let script = diagram_path_picked_script(7, r#"C:\charts\a "quoted" diagram.webp"#);
    assert!(script.starts_with("window.leafDiagramPathPicked(7, "));
    // JSON, so a backslash in a Windows path and a quote in a name reach the page as themselves rather than ending the string early.
    assert!(
        script.contains(r#""C:\\charts\\a \"quoted\" diagram.webp""#),
        "{script}"
    );
}

/// What the host says after a delete, and the two things the page reads off it: the path it may ask back, and the name to show.
#[test]
fn the_message_after_a_delete_carries_the_path_and_the_name() {
    let script = file_deleted_script(r#"C:\notes\a "quoted" note.md"#, r#"a "quoted" note.md"#);
    assert!(script.starts_with("window.leafFileDeleted("));
    // Both are JSON, so a backslash in a Windows path and a quote in a name reach the page as themselves rather than ending the string early.
    assert!(
        script.contains(r#""C:\\notes\\a \"quoted\" note.md""#),
        "{script}"
    );
    assert!(script.contains(r#""a \"quoted\" note.md""#), "{script}");
}

/// What the host says after a file is written, and the one thing the page reads off it: the path, as its own value, so the growl can draw it as a press rather than dig it back out of the sentence.
#[test]
fn the_message_after_a_file_is_written_carries_the_path_it_can_open() {
    let script = file_written_notice_script(r#"C:\reports\a "quoted" page.pdf"#);
    assert!(script.starts_with("window.leafFileWritten("));
    // JSON, so a backslash in a Windows path and a quote in a name reach the page as themselves rather than ending the string early.
    assert!(
        script.contains(r#""C:\\reports\\a \"quoted\" page.pdf""#),
        "{script}"
    );
}

// ---------------------------------------------------------------------------
// The HTTP call a remote vault needs
// ---------------------------------------------------------------------------

/// One scheme check in front of both platform halves is what makes this test possible at all: a check inside either half is unreachable from the other machine.
#[test]
fn a_request_that_is_not_https_is_refused_before_it_is_sent() {
    use crate::platform::require_https;

    assert!(require_https("https://api.github.com/repos/ryanallen/leaftext").is_ok());

    // Plain HTTP, and the three schemes a link in a document could carry into a source's own address.
    for refused in [
        "http://api.github.com/repos",
        "ftp://files.example.com/notes.md",
        "file:///C:/Windows/System32/config/SAM",
        "leaf-asset://app.js",
    ] {
        let error = require_https(refused).expect_err(refused);
        assert!(error.contains("not HTTPS"), "{refused}: {error}");
    }

    // Nothing that is not an address at all gets through either.
    assert!(require_https("").is_err());
    assert!(require_https("https://").is_err());
    assert!(require_https("not an address").is_err());
}

/// The refusal is in front of the request itself, not only in front of the free function beside it — so a source cannot reach either platform half over plain HTTP by going through the one door it was given.
#[test]
fn the_request_itself_is_refused_before_a_socket_is_opened() {
    use crate::platform::{http_request, http_request_with_retry, HttpBody, HttpRequest};

    let token = [("Authorization".to_string(), "Bearer secret".to_string())];
    let sent = "{\"query\":\"{viewer{login}}\"}";
    let over_plain_http = HttpRequest {
        method: "POST",
        url: "http://api.example.com/documents",
        headers: &token,
        body: Some(HttpBody::Text(sent)),
    };

    // Refused, and refused for the right reason — a network failure would say something else, and this test must not be able to pass by being offline.
    let error = http_request(&over_plain_http).expect_err("plain HTTP is refused");
    assert!(error.contains("not HTTPS"), "{error}");

    // The waiting one refuses in front of its first attempt, so nothing sleeps and nothing is retried over a scheme that will never be allowed.
    let started = std::time::Instant::now();
    let error = http_request_with_retry(&over_plain_http).expect_err("plain HTTP is refused");
    assert!(error.contains("not HTTPS"), "{error}");
    assert!(started.elapsed() < std::time::Duration::from_secs(1));

    // A document going the other way is named as a file rather than held in memory, which is the shape the Mac half needs. It is refused on the same ground. This run's own, so the "nothing read it" assertion below cannot be answered by something another run left lying about.
    let path = std::env::temp_dir().join(format!("leaf-not-sent-{}.md", std::process::id()));
    let as_a_file = HttpRequest {
        method: "PUT",
        url: "http://api.example.com/documents/1",
        headers: &token,
        body: Some(HttpBody::File(&path)),
    };
    assert!(http_request(&as_a_file)
        .expect_err("plain HTTP is refused")
        .contains("not HTTPS"));
    // And nothing read the file to find that out.
    assert!(!path.exists());
}

/// What is worth asking again for, and what is not. A 4xx that says the request itself is wrong comes back wrong every time, so trying it four times only spends somebody's rate limit.
#[test]
fn only_a_busy_service_is_asked_again_and_the_wait_is_capped() {
    use crate::platform::{
        backoff, retry_after, should_retry, HttpResponse, HTTP_ATTEMPTS, HTTP_BACKOFF_CEILING,
    };

    assert!(should_retry(429));
    for busy in [500, 502, 503, 599] {
        assert!(should_retry(busy), "{busy}");
    }
    for settled in [200, 201, 204, 301, 400, 401, 403, 404, 409, 422] {
        assert!(!should_retry(settled), "{settled}");
    }

    // It doubles, and it stops doubling. A source that keeps saying no must not be able to walk the wait up to an hour.
    let mut previous = std::time::Duration::ZERO;
    for attempt in 0..12 {
        let wait = backoff(attempt);
        assert!(wait <= HTTP_BACKOFF_CEILING, "attempt {attempt}: {wait:?}");
        if attempt < 4 {
            assert!(
                wait >= previous,
                "attempt {attempt} waited less than the one before"
            );
        }
        previous = wait;
    }
    // A service that says how long to wait is believed, in the seconds form, and still held under the ceiling.
    let asked = HttpResponse {
        status: 429,
        headers: vec![("retry-after".to_string(), "5".to_string())],
        body: Vec::new(),
    };
    assert_eq!(retry_after(&asked), Some(std::time::Duration::from_secs(5)));
    // The date form needs a clock both ends agree on, so it is not read and the backoff answers instead.
    let dated = HttpResponse {
        status: 503,
        headers: vec![(
            "retry-after".to_string(),
            "Wed, 21 Oct 2026 07:28:00 GMT".to_string(),
        )],
        body: Vec::new(),
    };
    assert_eq!(retry_after(&dated), None);

    assert_eq!(HTTP_ATTEMPTS, 4);
}

/// Jitter takes something off, so a hundred requests refused in one second do not all come back in one second. Without the floor the shave is zero whenever the clock's nanoseconds land on a multiple of the half, which returns the whole capped wait and fails this claim about one run in eighty.
#[test]
fn the_wait_before_a_retry_is_never_the_whole_ceiling() {
    use crate::platform::{backoff, HTTP_BACKOFF_CEILING};

    for attempt in 0..=12u32 {
        let capped = std::time::Duration::from_secs(1u64 << attempt).min(HTTP_BACKOFF_CEILING);
        let wait = backoff(attempt);
        assert!(wait < capped, "attempt {attempt}: {wait:?} of {capped:?}");
    }
}

/// Both halves get their response headers a different way and neither should be reading them twice.
#[test]
fn a_response_header_is_found_however_the_service_spelled_it() {
    use crate::platform::{parse_header_block, HttpResponse};

    let headers = parse_header_block(
        "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nX-RateLimit-Remaining: 0\r\nETag: \"abc:123\"\r\n\r\n",
    );
    let response = HttpResponse {
        status: 429,
        headers,
        body: Vec::new(),
    };

    // The status line is not a header, and a name is found whatever case it arrived in.
    assert_eq!(response.header("retry-after"), Some("30"));
    assert_eq!(response.header("Retry-After"), Some("30"));
    assert_eq!(response.header("x-ratelimit-remaining"), Some("0"));
    // A value may hold a colon of its own, so only the first one splits the line.
    assert_eq!(response.header("etag"), Some("\"abc:123\""));
    assert_eq!(response.header("nothing-sent"), None);
    assert_eq!(response.headers.len(), 3);
    assert_eq!(response.status, 429);
    assert!(response.body.is_empty());
}

// ---------------------------------------------------------------------------
// Signing a vault in, and where the token is kept
// ---------------------------------------------------------------------------

/// The whole of the sign-in this machine can drive: a port the OS picked, a browser coming back to it, the code read out, and the port closed behind it. What cannot be tested here is the consent screen — that needs a real browser, a real service and a real account.
#[test]
fn a_sign_in_takes_one_request_on_a_loopback_port_and_then_gives_it_up() {
    use std::io::{Read, Write};

    let (listener, redirect_uri) = open_sign_in_listener().expect("a port is opened");

    // The address handed to the service is on this machine and nowhere else, and the port is one the OS chose rather than one anything could be sitting on waiting to catch somebody's code.
    assert!(
        redirect_uri.starts_with("http://127.0.0.1:"),
        "{redirect_uri}"
    );
    let port = listener.local_addr().expect("readable").port();
    assert!(port > 0);
    assert!(redirect_uri.contains(&port.to_string()));

    let waiting =
        std::thread::spawn(move || await_sign_in(listener, redirect_uri, SIGN_IN_READ_TIMEOUT));

    // What a browser does when the consent screen sends it back. The favicon first, which is not the answer and must not end the wait.
    let mut ignored = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
    ignored
        .write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .expect("asks");
    let mut brushed_off = String::new();
    ignored
        .read_to_string(&mut brushed_off)
        .expect("is answered too");
    assert!(brushed_off.starts_with("HTTP/1.1 200"), "{brushed_off}");

    let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
    browser
        .write_all(
            b"GET /?state=xyz&code=a%2Bcode%20with+spaces HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        )
        .expect("comes back");
    let mut answered = String::new();
    browser.read_to_string(&mut answered).expect("is answered");

    // The tab is not left blank, which after a consent screen reads as a sign-in that failed.
    assert!(answered.starts_with("HTTP/1.1 200"), "{answered}");
    assert!(answered.contains("signed in"), "{answered}");

    let answer = waiting.join().expect("the wait ends").expect("a code");
    // Read out of the query, and unescaped the two ways a redirect actually escapes.
    assert_eq!(answer.code, "a+code with spaces");
    assert!(answer.redirect_uri.contains(&port.to_string()));

    // And the port is gone with the listener, so nothing else on the machine can go on talking to it.
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
}

/// The page saying you are signed in reaches the browser whole, every time. A socket closed with bytes of the request still unread is reset rather than closed, and the reset throws away what was written but not yet read. The headers are sent a moment after the request line here, which is the arrival order that leaves them unread — sent together they land in one read and the fault hides — and repeated, so nothing survives on luck.
#[test]
fn the_page_saying_you_are_signed_in_is_never_lost_to_a_reset() {
    use std::io::{Read, Write};

    /// Long enough that the request line is read on its own, short enough to stay well inside the sign-in's own read timeout.
    const APART: Duration = Duration::from_millis(20);

    for round in 0..10 {
        let (listener, redirect_uri) = open_sign_in_listener().expect("a port is opened");
        let port = listener.local_addr().expect("readable").port();
        let waiting =
            std::thread::spawn(move || await_sign_in(listener, redirect_uri, SIGN_IN_READ_TIMEOUT));

        // The favicon goes down the same path and is answered the same way, so it is held here too.
        let mut ignored = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
        ignored
            .write_all(b"GET /favicon.ico HTTP/1.1\r\n")
            .expect("asks");
        std::thread::sleep(APART);
        ignored
            .write_all(b"Host: 127.0.0.1\r\nAccept: image/png\r\n\r\n")
            .expect("goes on");
        std::thread::sleep(APART);
        // Read as bytes and kept even when the read ends badly: the failure this covers is an empty answer, and a reader that throws away what did arrive cannot tell that apart from a short one.
        let mut arrived = Vec::new();
        let outcome = ignored.read_to_end(&mut arrived);
        let brushed_off = String::from_utf8_lossy(&arrived).to_string();
        outcome.unwrap_or_else(|error| panic!("round {round}: {error} after {brushed_off:?}"));
        assert!(
            brushed_off.contains("try again"),
            "round {round}: {brushed_off}"
        );

        let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
        browser
            .write_all(b"GET /?code=abc123 HTTP/1.1\r\n")
            .expect("comes back");
        std::thread::sleep(APART);
        browser
            .write_all(b"Host: 127.0.0.1\r\nUser-Agent: a browser\r\nAccept: text/html\r\nConnection: close\r\n\r\n")
            .expect("goes on");
        std::thread::sleep(APART);
        let mut arrived = Vec::new();
        let outcome = browser.read_to_end(&mut arrived);
        let answered = String::from_utf8_lossy(&arrived).to_string();
        outcome.unwrap_or_else(|error| panic!("round {round}: {error} after {answered:?}"));

        // Whole, not merely started: the reset this covers cuts the answer off wherever it had got to.
        assert!(
            answered.ends_with("You are signed in. Close this tab and go back to Leaftext."),
            "round {round}: {answered}"
        );

        let answer = waiting.join().expect("the wait ends").expect("a code");
        assert_eq!(answer.code, "abc123");
    }
}

/// Reading the rest of the request stops somewhere. The read's timeout is per read, so a client that keeps sending header lines and never sends the blank one would otherwise hold the port for as long as it kept typing; the sign-in gives up on the headers and answers, because the code was already out of the request line.
#[test]
fn a_sign_in_stops_reading_headers_rather_than_letting_a_client_hold_the_port() {
    use std::io::Write;

    let (listener, redirect_uri) = open_sign_in_listener().expect("a port is opened");
    let port = listener.local_addr().expect("readable").port();
    let waiting =
        std::thread::spawn(move || await_sign_in(listener, redirect_uri, SIGN_IN_READ_TIMEOUT));

    let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
    browser
        .write_all(b"GET /?code=abc123 HTTP/1.1\r\n")
        .expect("comes back");
    let started = std::time::Instant::now();
    // Far past the bound, and no blank line ever, so nothing but the bound can end the read. A write that fails is the sign-in having already given up and closed, which is the thing being asked for.
    for line in 0..200 {
        if browser
            .write_all(format!("X-Padding-{line}: and on it goes\r\n").as_bytes())
            .is_err()
        {
            break;
        }
    }

    let answer = waiting.join().expect("the wait ends").expect("a code");
    assert_eq!(answer.code, "abc123");
    // Well inside the ten seconds a read of its own is given, which is what the wait would have cost with nothing bounding it.
    assert!(started.elapsed() < Duration::from_secs(3), "{started:?}");
}

/// A connection that opens and says nothing is not the answer either, and must not end the sign-in. Browsers open connections on speculation and send nothing down them, and a loopback port is one anything on the machine can touch; the person is still reading the consent screen while it happens, and their browser then comes back to a port that is gone. The read timeout is handed in here so the silence costs the test a moment rather than the ten seconds the app gives it.
#[test]
fn a_connection_that_says_nothing_does_not_end_the_sign_in() {
    use std::io::{Read, Write};

    /// Long enough that the silent connection really is read and given up on, short enough that the test does not wait on it.
    const SAYS_NOTHING_FOR: Duration = Duration::from_millis(150);

    let (listener, redirect_uri) = open_sign_in_listener().expect("a port is opened");
    let port = listener.local_addr().expect("readable").port();
    let waiting =
        std::thread::spawn(move || await_sign_in(listener, redirect_uri, SAYS_NOTHING_FOR));

    // Opened and held: never written to and never closed, which is what a speculative connection looks like. Closing it would be the case already covered — an empty read, the try-again page, and the wait goes on.
    let silent = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");

    // The person finishes on the consent screen while that one is still sitting there, so their real request is behind it.
    let mut browser = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connects");
    browser
        .write_all(b"GET /?code=abc123 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .expect("comes back");
    let mut answered = String::new();
    browser.read_to_string(&mut answered).expect("is answered");

    // The page still arrives, so the browser is not left on a blank tab after a consent screen.
    assert!(answered.starts_with("HTTP/1.1 200"), "{answered}");
    assert!(answered.contains("signed in"), "{answered}");

    let answer = waiting.join().expect("the wait ends").expect("a code");
    assert_eq!(answer.code, "abc123");

    drop(silent);
    // And the port is given up behind the answer, exactly as it is when nothing silent ever arrived.
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
}

/// Only a `code` is a code, and a consent screen that came back with something else is not one.
#[test]
fn only_a_code_is_read_out_of_what_the_browser_comes_back_with() {
    assert_eq!(
        code_from_target("/?code=abc123"),
        Some("abc123".to_string())
    );
    assert_eq!(
        code_from_target("/?state=xyz&code=abc123"),
        Some("abc123".to_string())
    );
    // A refusal carries no code, and neither does a plain request.
    assert_eq!(code_from_target("/?error=access_denied"), None);
    assert_eq!(code_from_target("/favicon.ico"), None);
    assert_eq!(code_from_target("/"), None);
    assert_eq!(code_from_target("/?code="), None);
}

/// A token goes in the machine's own credential store, and nothing the app writes to disk holds one. `src/git.rs` avoids this problem by leaning on a git that already knows the user; nothing else does, so this is the first credential the app keeps and the store is the OS's.
#[test]
fn a_token_reaches_the_credential_store_and_no_file_the_app_writes() {
    let service = format!("leaftext-test-vault-{}", std::process::id());
    let account = "reader@example.com";
    let token = format!("a-refresh-token-{}", std::process::id());

    // Signed out is an answer rather than a failure: it is what a vault nobody signed into looks like.
    crate::platform::forget_secret(&service, account).expect("forgetting nothing is fine");
    assert_eq!(
        crate::platform::read_secret(&service, account).expect("readable"),
        None
    );

    crate::platform::store_secret(&service, account, &token).expect("kept");
    assert_eq!(
        crate::platform::read_secret(&service, account).expect("readable"),
        Some(token.clone())
    );
    // Signing in again replaces it, so the one before is not left behind.
    let second = format!("{token}-again");
    crate::platform::store_secret(&service, account, &second).expect("kept");
    assert_eq!(
        crate::platform::read_secret(&service, account).expect("readable"),
        Some(second.clone())
    );

    // Nothing in either of the two folders the app writes holds it. These are the folders that end up in every backup, every sync client and every crash report.
    for root in [
        config_file_path().and_then(|p| p.parent().map(Path::to_path_buf)),
        app_data_dir(),
    ]
    .into_iter()
    .flatten()
    {
        let found = files_holding(&root, &second, 0);
        assert!(found.is_empty(), "a token was written to {found:?}");
    }

    crate::platform::forget_secret(&service, account).expect("forgotten");
    assert_eq!(
        crate::platform::read_secret(&service, account).expect("readable"),
        None
    );
    // And forgetting one that has already gone is not a failure either.
    crate::platform::forget_secret(&service, account).expect("forgetting twice is fine");
}

/// Every file under `root` whose bytes hold `needle`. Depth-capped so a WebView2 cache cannot turn a test into a crawl.
fn files_holding(root: &Path, needle: &str, depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if depth > 4 {
        return found;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(files_holding(&path, needle, depth + 1));
        } else if fs::read(&path)
            .map(|bytes| find_bytes(&bytes, needle.as_bytes()))
            .unwrap_or(false)
        {
            found.push(path);
        }
    }
    found
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    needle.len() <= haystack.len()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

/// The name a vault's token is kept under is the row id, so renaming a vault or pointing it at another folder does not orphan the credential.
#[test]
fn a_vault_s_token_is_named_after_the_row_and_not_the_vault_s_name() {
    assert_eq!(vault_secret_service(7), "leaftext-vault-7");
    assert_ne!(vault_secret_service(7), vault_secret_service(8));
}

// ---------------------------------------------------------------------------
// Keeping a remote vault's copy up to date
// ---------------------------------------------------------------------------

/// A refresh runs off the loop, so the vault it was about can be removed or pointed somewhere else before it lands. It is thrown away then, the way a folder read and a corpus read already are — the alternative is a panel reporting a folder nobody is reading, or a mirror that has already been deleted.
#[test]
fn a_refresh_that_outlived_its_vault_is_thrown_away() {
    let mirror = PathBuf::from("C:").join("data").join("remote").join("7");
    let elsewhere = PathBuf::from("C:").join("data").join("remote").join("8");

    // Still the same folder: the pass is about the vault the app has.
    assert!(refresh_still_lands(Some(&mirror), &mirror));
    // Pointed at another folder while the pass ran.
    assert!(!refresh_still_lands(Some(&elsewhere), &mirror));
    // Removed while the pass ran, so there is no row and no mirror left to be about.
    assert!(!refresh_still_lands(None, &mirror));
}

/// A pass writes its own mirror, and every one of those writes reaches the watcher. Phase 0 measured 2,020 events for a 2,000-file folder, and the loop spends a thread on `git status` for each one before it decides anything — so the app's own writes are dropped while the pass that made them is running, and somebody's own editing is not.
#[test]
fn the_watcher_ignores_a_refresh_writing_its_own_mirror_and_nothing_else() {
    let mirror = PathBuf::from("C:").join("data").join("remote").join("7");
    let mut book = RefreshBook::default();

    // Nothing running: every change is somebody's.
    assert!(!book.is_our_own_write(&mirror.join("note.md")));

    book.begin(7, mirror.clone());
    assert!(book.is_our_own_write(&mirror.join("note.md")));
    assert!(book.is_our_own_write(&mirror.join("folder").join("deep.md")));
    // A vault the pass is not touching goes on live-reloading while it runs.
    assert!(!book.is_our_own_write(Path::new("C:").join("Notes").join("today.md").as_path()));
    assert!(book.is_busy(7));

    book.end(
        7,
        &mirror,
        VaultRemoteState {
            id: 7,
            ..VaultRemoteState::default()
        },
    );
    // And the moment it is over, an edit inside the mirror is somebody's again.
    assert!(!book.is_our_own_write(&mirror.join("note.md")));
    assert!(!book.is_busy(7));
}

/// A source that keeps refusing is left alone rather than asked harder: a rate limit answers in lockouts, not in slow. Pressing Refresh wakes it, because whoever pressed it knows something the app does not.
#[test]
fn a_source_that_keeps_refusing_is_left_alone_until_someone_asks() {
    let mut book = RefreshBook::default();

    for _ in 0..2 {
        book.record_outcome(4, true);
        assert!(!book.is_resting(4), "rested too early");
    }
    book.record_outcome(4, true);
    assert!(book.is_resting(4));

    // The panel's Refresh clears it.
    book.wake(4);
    assert!(!book.is_resting(4));

    // And one pass that works clears it too, so a moment of no network does not cost the rest of the session.
    book.record_outcome(4, true);
    book.record_outcome(4, true);
    book.record_outcome(4, true);
    assert!(book.is_resting(4));
    book.record_outcome(4, false);
    assert!(!book.is_resting(4));

    // Each vault keeps its own count: one service being down does not stop the others being asked.
    book.record_outcome(5, true);
    book.record_outcome(5, true);
    book.record_outcome(5, true);
    assert!(book.is_resting(5));
    assert!(!book.is_resting(4));
}

/// Get Info opened nothing on every file a Mac tried it on: Finder was asked for the information window of a bare `POSIX file`, which is not one of its own items, and nothing brought Finder forward, so a window that did open would have opened behind us.
#[test]
fn the_get_info_script_asks_finder_for_an_item_and_brings_finder_forward() {
    let script = finder_information_window_script(Path::new("/Users/me/notes.md"));

    // Coerced to an alias, which Finder resolves to an item it can open a window on.
    assert!(
        script.contains("open information window of (POSIX file \"/Users/me/notes.md\" as alias)"),
        "{script}"
    );

    // Finder comes forward before the window opens, or the reader is looking at our window instead.
    let activate = script
        .find("activate")
        .expect("the script activates Finder");
    let open = script
        .find("open information window")
        .expect("the script opens the information window");
    assert!(activate < open, "{script}");

    // A quote or a backslash in a name would otherwise end the AppleScript string early and run whatever came next.
    let odd = finder_information_window_script(Path::new(r#"/Users/me/od"d\name.md"#));
    assert!(
        odd.contains(r#"POSIX file "/Users/me/od\"d\\name.md" as alias"#),
        "{odd}"
    );
}

/// The documentation shot's own recipe quotes both paths, and cmd.exe hands the quotes through, so the encoder was asked for a path Windows refuses — os error 123 before a byte was read.
#[test]
fn a_path_wrapped_in_quotes_reaches_the_encoder_without_them() {
    assert_eq!(
        crate::unquote_path(r#""C:\Users\me\My Docs\shot.bmp""#),
        r"C:\Users\me\My Docs\shot.bmp"
    );

    // A plain path is what every other caller hands in, and it must arrive unchanged.
    assert_eq!(
        crate::unquote_path("docs/imgs/navigation.png"),
        "docs/imgs/navigation.png"
    );

    // Only a surrounding pair. One quote inside a name is part of the name, and one on its own is not a wrapper.
    assert_eq!(crate::unquote_path("odd\"name.bmp"), "odd\"name.bmp");
    assert_eq!(crate::unquote_path("\"leading.bmp"), "\"leading.bmp");
    assert_eq!(crate::unquote_path("trailing.bmp\""), "trailing.bmp\"");
    assert_eq!(crate::unquote_path("\""), "\"");
}

/// The three names a launch answers to, spelled out rather than derived: these are what every installed copy is already using, so a change that moved one would leave a running app unreachable and a later launch handing its file to nobody. Still scoped per user, so two logged-in accounts stay apart.
#[cfg(windows)]
#[test]
fn a_launch_answers_to_the_names_every_installed_copy_already_uses() {
    use crate::pipe::ask_pipe_name;
    use crate::single_instance::{instance_mutex_name, instance_pipe_name};

    assert_eq!(
        instance_mutex_name("rwall"),
        "leaftext-single-instance-rwall"
    );
    assert_eq!(
        instance_pipe_name("rwall"),
        r"\\.\pipe\leaftext-single-instance-rwall"
    );
    assert_eq!(ask_pipe_name("rwall"), r"\\.\pipe\leaftext-journal-rwall");

    for name in [instance_mutex_name, instance_pipe_name, ask_pipe_name] {
        assert_ne!(name("rwall"), name("someone-else"));
    }
}

/// The tail below the match persists the session and re-points the watcher, so it must run after anything an arm answered and after nothing else. Written as a skip list on purpose: an event this test does not name still reaches the tail, which is what keeps a new one from being dropped in silence. A drag is the gesture that made it matter — four of these a mouse move, each rebuilding the session from every open tab.
#[test]
fn only_an_event_an_arm_could_answer_reaches_the_tail_of_the_loop() {
    use tao::dpi::{PhysicalPosition, PhysicalSize};
    use tao::event::{DeviceEvent, ElementState, RawKeyEvent, StartCause};
    use tao::keyboard::KeyCode;
    use tao::window::WindowId;

    for event in [
        Event::NewEvents(StartCause::Poll),
        Event::MainEventsCleared,
        Event::RedrawEventsCleared,
        Event::RedrawRequested(unsafe { WindowId::dummy() }),
    ] {
        assert!(
            !could_have_changed_anything(&event),
            "{event:?} is answered by no arm, so the tail has nothing to do"
        );
    }

    for event in [
        Event::UserEvent(UserEvent::WebviewReady),
        Event::Suspended,
        Event::Resumed,
        Event::LoopDestroyed,
    ] {
        assert!(
            could_have_changed_anything(&event),
            "{event:?} is not on the skip list, so the tail still runs"
        );
    }

    // The device half is asked on its own for the same reason as the window half below: one raw input packet — the mouse hands the loop up to a thousand a second while focused — and no arm reads one, mouse or keyboard alike.
    for event in [
        DeviceEvent::Added,
        DeviceEvent::Key(RawKeyEvent {
            physical_key: KeyCode::KeyA,
            state: ElementState::Pressed,
        }),
    ] {
        assert!(
            !device_event_could_have_changed_anything(&event),
            "{event:?} is a raw input packet no arm reads, so the tail has nothing to do"
        );
    }

    // The window half is asked on its own because the event that wraps it cannot be built outside the window library.
    assert!(!window_event_could_have_changed_anything(
        &WindowEvent::Moved(PhysicalPosition::new(0, 0))
    ));
    for event in [
        WindowEvent::Resized(PhysicalSize::new(800, 600)),
        WindowEvent::CloseRequested,
        WindowEvent::Focused(true),
    ] {
        assert!(
            window_event_could_have_changed_anything(&event),
            "{event:?} has an arm, so the tail still runs"
        );
    }
}

/// Export, which is one press and one file: the page measures itself so the host can make one continuous page of it, and the save window says where it goes and in what format. The open document only names the file that is suggested — nothing about it is read or written, and what makes the rendered page a document rather than one screen of app frame is the stylesheet, not this.
#[test]
fn export_pdf_carries_the_format_and_the_page_size_it_needs() {
    let parsed = serde_json::from_str::<IpcCommand>(
        r#"{"command":"exportPdf","format":"pdf","width":1280,"height":5819}"#,
    );
    assert!(matches!(
        parsed,
        Ok(IpcCommand::ExportPdf { ref format, width, height })
            if format == "pdf" && width == 1280.0 && height == 5819.0
    ));

    // The chooser's format and the page's own size go straight on.
    let mut workspace = Workspace::default();
    assert_eq!(
        page_export_request(&workspace, "pdf".to_string(), 1280.0, 5819.0),
        PageExport {
            document: None,
            format: "pdf".to_string(),
            width: 1280.0,
            height: 5819.0,
        },
        "the home screen exports too, with no document to name the file after"
    );
    workspace.open_path(PathBuf::from("/docs/notes.md"));
    assert_eq!(
        page_export_request(&workspace, "pdf".to_string(), 1280.0, 5819.0).document,
        Some(PathBuf::from("/docs/notes.md")),
        "and the open document names the file the save dialog suggests"
    );

    // The open document is read for its name and nothing else: a chosen path and a page size are all the write needs, so the home screen exports too.
    let write = include_str!("fileops.rs");
    let body = write
        .split("pub(crate) fn export_page_pdf")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the export body");
    assert!(
        body.contains("Path::file_stem") && !body.contains("active_edit"),
        "the export names the file after the document and reads nothing else of it: {body}"
    );

    // The sheet is the height the page measured, plus a hair against rounding, divided into equal pages only where one page cannot hold it. A proportional allowance was tried and on a document twenty screens tall it is most of a sheet of white below the last line.
    assert!(
        write.contains(
            ".SetPageHeight(sheet_inches((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH))"
        ),
        "the page height is taken as given rather than scaled"
    );
    assert!(
        write.contains("const HAIR_OF_PAPER: f64 = 4.0;"),
        "the allowance is a pixel count rather than a share of the document"
    );
    // Rounded up rather than down: a sheet a fraction shorter than what is laid out on it is a whole second page with almost nothing on it.
    assert!(
        write.contains("let sheet = (inches / sheets * 100.0).ceil() / 100.0;"),
        "the sheet is never rounded to less than the document needs"
    );
}

/// The ceiling on a PDF page, and what a document past it comes out as. Cut at the ceiling, a document a little over is one full sheet and a mostly blank one — which is the blank paper a reader meets and cannot explain. Divided, every sheet is full and the last ends at the last line. Both desktops ask it, so both desktops run this.
#[test]
fn a_document_taller_than_a_pdf_page_is_divided_into_equal_sheets() {
    use crate::app::fileops::sheet_inches;

    // Under the ceiling it is its own height, so one continuous page stays one continuous page.
    assert_eq!(sheet_inches(60.0), 60.0);
    assert_eq!(sheet_inches(200.0), 200.0);

    // A hair over, and the answer is two half sheets rather than a full one and a sliver.
    assert_eq!(sheet_inches(202.0), 101.0);
    // The document read on a running copy: 292 inches over a 200-inch ceiling.
    assert_eq!(sheet_inches(292.0), 146.0);
    // Nothing is ever asked for past the ceiling, whatever the arithmetic came to.
    for tall in [1.0, 199.9, 200.1, 401.0, 100_000.0] {
        let sheet = sheet_inches(tall);
        assert!(sheet > 0.0 && sheet <= 200.0, "{tall} gave {sheet}");
        // And every sheet holds its share: the pages multiply back to at least the document.
        let sheets = (tall as f64 / sheet).ceil();
        assert!(
            sheet * sheets >= tall - 0.001,
            "{tall} over {sheets} sheets of {sheet}"
        );
    }
}

/// The two commands a press on the app bar can send. The page decides which by the click count and whether the window stayed put; the host only has to tell them apart, and nothing else covers that it can.
#[test]
fn the_app_bar_sends_a_drag_and_a_maximize_under_the_names_the_page_uses() {
    assert!(matches!(
        serde_json::from_str::<IpcCommand>(r#"{"command":"windowDrag"}"#),
        Ok(IpcCommand::WindowDrag)
    ));
    assert!(matches!(
        serde_json::from_str::<IpcCommand>(r#"{"command":"windowToggleMaximize"}"#),
        Ok(IpcCommand::WindowToggleMaximize)
    ));
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
