//! Editing a document in place: the splice, the refusal, and a tick on a box.

use super::*;

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

/// The whole of the fault this file's editing tests were missing: a document whose file has gone answers nothing at all, and the reader is left able to press Save on a document nothing reached. The refusal has to come back as words, and the tab must be left holding no buffer — a half-seeded one would be a document invented out of a failed read.
#[test]
fn an_edit_whose_file_has_gone_answers_why_and_leaves_the_tab_holding_nothing() {
    let dir =
        scratch_dir("an_edit_whose_file_has_gone_answers_why_and_leaves_the_tab_holding_nothing");
    let gone = dir.join("watch.md");

    let mut workspace = Workspace::default();
    workspace.open_path(gone.clone());

    let answer = apply_block_edit(&mut workspace, 0, 0, "alpha", true, None);

    assert_eq!(
        answer,
        Err("the file could not be read".to_string()),
        "the reason travels back as the sentence the reader is shown"
    );
    assert!(
        workspace.tabs[0].edit.is_none(),
        "a failed read seeds nothing, so the tab holds no buffer at all"
    );

    // And a workspace with no tab at all — the home screen — is answered by the same door.
    let mut empty = Workspace::default();
    assert_eq!(
        apply_block_edit(&mut empty, 0, 0, "alpha", true, None),
        Err("no document is open".to_string())
    );

    let _ = fs::remove_dir_all(&dir);
}

/// The decision the loop spends, held by calling it. The loop never returns, so a test cannot reach inside it, and reading `event_loop.rs` as text is refused outright: ten tests that did it all passed with their subject deleted.
#[test]
fn the_edit_block_decision_says_refused_when_the_file_has_gone_and_spliced_when_it_is_there() {
    let dir = scratch_dir(
        "the_edit_block_decision_says_refused_when_the_file_has_gone_and_spliced_when_it_is_there",
    );
    let there = dir.join("here.md");
    fs::write(&there, "# Here\n").expect("the document is written");
    let gone = dir.join("watch.md");

    let asked = |text: &'static str| BlockEdit {
        start: 0,
        end: 0,
        text,
        autosave: false,
        live: false,
        continuing: false,
        cell: None,
    };

    let mut missing = Workspace::default();
    missing.open_path(gone);
    match edit_block_outcome(&mut missing, &asked("alpha")) {
        BlockEditOutcome::Refused(why) => assert_eq!(why, "the file could not be read"),
        BlockEditOutcome::Spliced { .. } => panic!("a file that is not there cannot be written to"),
    }
    assert_eq!(
        front_document_name(&missing),
        "watch.md",
        "the growl names the file, not the tab's label"
    );

    let mut open = Workspace::default();
    open.open_path(there.clone());
    match edit_block_outcome(&mut open, &asked("alpha ")) {
        BlockEditOutcome::Spliced { autosave, render } => {
            assert!(!autosave, "an ordinary keystroke waits for Save");
            assert!(render, "a splice that is not live redraws the page");
        }
        BlockEditOutcome::Refused(why) => panic!("the file is there: {why}"),
    }
    assert_eq!(
        open.active_edit().expect("the buffer was seeded").text(),
        "alpha # Here\n",
        "the splice landed in the buffer"
    );

    // A live splice leaves the page standing, and a checkbox toggle writes itself to disk.
    let mut typing = Workspace::default();
    typing.open_path(there);
    let live = BlockEdit {
        start: 0,
        end: 0,
        text: "x",
        autosave: true,
        live: true,
        continuing: false,
        cell: None,
    };
    match edit_block_outcome(&mut typing, &live) {
        BlockEditOutcome::Spliced { autosave, render } => {
            assert!(autosave);
            assert!(
                !render,
                "a render would take the words out from under the caret"
            );
        }
        BlockEditOutcome::Refused(why) => panic!("the file is there: {why}"),
    }

    let _ = fs::remove_dir_all(&dir);
}

/// What the refused branch sends instead of a resync: the tab dot down, Save down, Undo and Redo down. The page reads these four and nothing else, so a wrong one is a button lit over a document nothing was written to.
#[test]
fn the_cleared_editing_state_says_nothing_is_held_for_the_document_at_the_front() {
    let script = cleared_editing_state_script();

    assert!(
        script.contains("window.leafBlocksResynced("),
        "the page's own handler reads it"
    );
    assert!(
        script.contains("\"dirty\":false"),
        "the tab dot and Save go down"
    );
    assert!(
        script.contains("\"canUndo\":false"),
        "there is nothing to undo"
    );
    assert!(
        script.contains("\"canRedo\":false"),
        "there is nothing to redo"
    );
    assert!(
        script.contains("\"source\":null"),
        "nothing is re-rendered: there is nothing to render from"
    );
}

/// Why the refused branch cannot call the resync. A tab's buffer belongs to one file while the tab navigates across many, and the script carries no path — so the resync would stamp the buffer's dirty and undo state onto whatever document is at the front.
#[test]
fn a_tab_that_navigated_away_from_the_document_it_edited_is_answered_for_the_one_on_screen() {
    let dir = scratch_dir(
        "a_tab_that_navigated_away_from_the_document_it_edited_is_answered_for_the_one_on_screen",
    );
    let edited = dir.join("edited.md");
    let followed = dir.join("followed.md");

    let mut workspace = Workspace::default();
    workspace.open_path(edited.clone());
    workspace.tabs[0].edit = Some(EditableDocument::new(
        edited.clone(),
        SourceText::utf8("# Edited\n".to_string()),
    ));
    workspace
        .active_edit_mut()
        .expect("the buffer is there")
        .replace_range(0, 0, "typed ");
    // The link is followed. The tab keeps the buffer it was editing; the document on screen is the other one.
    workspace.tabs[0].history.record(followed.clone());

    let held = workspace.active_edit().expect("the tab kept its buffer");
    assert_eq!(
        held.path, edited,
        "the buffer still belongs to the document it was opened over"
    );
    assert_eq!(
        workspace.tabs[0].history.current(),
        Some(&followed),
        "and the tab is showing the other one"
    );
    assert!(
        editing_state_script(held).contains("\"dirty\":true"),
        "a resync here would light Save over a document nothing was typed into"
    );
    assert!(
        cleared_editing_state_script().contains("\"dirty\":false"),
        "the refused branch answers for the document on screen instead"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// The other four doors into the same failed seed. Each was watched returning without a word, so a reader who opened the source, typed a field, dragged a block or ticked a box on a document whose file had gone got nothing at all — and the checkbox had already drawn itself ticked.
#[test]
fn every_command_sharing_the_seed_answers_why_rather_than_nothing_when_the_file_has_gone() {
    let dir = scratch_dir(
        "every_command_sharing_the_seed_answers_why_rather_than_nothing_when_the_file_has_gone",
    );
    let gone = dir.join("watch.md");
    let missing = || {
        let mut workspace = Workspace::default();
        workspace.open_path(gone.clone());
        workspace
    };
    let gone_reason = "the file could not be read".to_string();

    assert_eq!(
        enter_code_view(None, &mut missing(), None),
        Err(gone_reason.clone()),
        "Code view says why the source cannot be shown"
    );
    assert_eq!(
        apply_field_edit(&mut missing(), "title", FieldEdit::Set("Watch")),
        Err(gone_reason.clone()),
        "Set field says why the field was not written"
    );
    assert_eq!(
        apply_block_move(&mut missing(), &[(0, 4)], 0, 1),
        Err(gone_reason.clone()),
        "Move block says why nothing moved"
    );

    let mut ticking = missing();
    let mut watch = FileWatch::default();
    let mut vaults = VaultState::load(None);
    let refusal = flip_task_and_save(None, &mut ticking, &mut watch, &mut vaults, 0)
        .err()
        .expect("and the checkbox, which had already drawn itself ticked");
    assert_eq!(refusal.why, gone_reason);
    assert!(
        !refusal.held,
        "a failed seed holds nothing, so the box comes back up too"
    );

    // A file that is there answers the buffer rather than a sentence, so the refusal is the read and not the shape of the call.
    let there = dir.join("here.md");
    fs::write(&there, "# Here\n\nalpha\n").expect("the document is written");
    let mut open = Workspace::default();
    open.open_path(there);
    assert_eq!(
        apply_field_edit(&mut open, "title", FieldEdit::Set("Here")),
        Ok(true),
        "the field lands in the buffer"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// Pressing Save after a refused edit was silent in its own right: the routine answered before it composed a single line for the page, so the one control a reader reaches for after the silence was silent too.
#[test]
fn a_save_of_a_document_the_app_holds_no_buffer_for_says_so_rather_than_answering_nobody() {
    let dir = scratch_dir(
        "a_save_of_a_document_the_app_holds_no_buffer_for_says_so_rather_than_answering_nobody",
    );
    let gone = dir.join("watch.md");
    let mut workspace = Workspace::default();
    workspace.open_path(gone);

    let mut watch = FileWatch::default();
    let mut vaults = VaultState::load(None);
    let mut book = RefreshBook::default();
    let answer = save_active_document(None, &mut workspace, &mut watch, &mut vaults, &mut book);

    assert_eq!(
        answer,
        Err("no document is open".to_string()),
        "the asker on the pipe keeps the answer it already had"
    );
    // And the reader gets the sentence the routine never composed.
    assert_eq!(
        save_refusal_script(&workspace).as_deref(),
        Some("window.leafShowError(\"watch.md was not changed: the app is holding no changes for it.\");"),
        "the growl names the document and says nothing was written"
    );

    // A document the app is holding is saved without a word about it.
    let there = dir.join("here.md");
    let mut holding = Workspace::default();
    holding.open_path(there.clone());
    holding.tabs[0].edit = Some(EditableDocument::new(
        there,
        SourceText::utf8(
            "# Here
"
            .to_string(),
        ),
    ));
    assert_eq!(save_refusal_script(&holding), None);

    let _ = fs::remove_dir_all(&dir);
}

/// The four ways a tick can go, and the one word the page acts on. Every box draws itself ticked before the command leaves, so a tick standing on nothing has to come back as nothing — and a tick the buffer took over a file that then refused the write has to come back as held, or the page would take a real change off the screen and leave the reader an unsaved document that looks untouched.
#[test]
fn a_tick_answers_whether_the_buffer_holds_it_for_both_kinds_of_box() {
    let dir = scratch_dir("a_tick_answers_whether_the_buffer_holds_it_for_both_kinds_of_box");
    let note = dir.join("tasks.md");
    let source = "| a | b |
| --- | --- |
| [ ] one | two |

- [ ] three
";
    fs::write(&note, source).expect("the note is written");

    // A tab holding its buffer already, so nothing below re-reads a disk that is about to go.
    let seeded = || {
        let mut workspace = Workspace::default();
        workspace.open_path(note.clone());
        workspace.tabs[0].edit = Some(EditableDocument::new(
            note.clone(),
            SourceText::utf8(source.to_string()),
        ));
        workspace
    };
    let mut ticking = seeded();
    let mut splicing = seeded();
    let mut counted = seeded();
    let mut watch = FileWatch::default();
    let mut vaults = VaultState::load(None);

    // A plain list's box over a file that cannot be read: nothing is seeded, so nothing is held.
    let gone = dir.join("elsewhere").join("tasks.md");
    let mut unread = Workspace::default();
    unread.open_path(gone);
    let refusal = flip_task_and_save(None, &mut unread, &mut watch, &mut vaults, 0)
        .err()
        .expect("a file that cannot be read is written to by nobody");
    assert_eq!(refusal.why, "the file could not be read");
    assert!(
        !refusal.held,
        "there is no buffer at all, so the box is standing on air"
    );

    // A table's box over the same unreadable file, which is the other command and the same answer.
    let mut unread = Workspace::default();
    unread.open_path(dir.join("elsewhere").join("tasks.md"));
    let table = |text: &'static str| BlockEdit {
        start: 0,
        end: 0,
        text,
        autosave: true,
        live: false,
        continuing: false,
        cell: None,
    };
    match edit_block_outcome(
        &mut unread,
        &table(
            "| a |
",
        ),
    ) {
        BlockEditOutcome::Refused(why) => assert_eq!(why, "the file could not be read"),
        BlockEditOutcome::Spliced { .. } => panic!("there is nothing to splice into"),
    }

    // A plain list's box at a task number the document has not got: the buffer is there and it did not move.
    let refusal = flip_task_and_save(None, &mut counted, &mut watch, &mut vaults, 7)
        .err()
        .expect("there is no eighth task");
    assert!(
        !refusal.held,
        "a task that is not there moves nothing, so the box comes back up"
    );
    assert!(
        !counted
            .active_edit()
            .expect("the buffer is there")
            .is_dirty(),
        "and the document is exactly as clean as it was"
    );

    // Now the folder goes while the app is still up — the owner's own gesture, and the only way a write fails here.
    fs::remove_dir_all(&dir).expect("the folder is deleted under the app");

    // A plain list's box the buffer took and the file refused.
    let refusal = flip_task_and_save(None, &mut ticking, &mut watch, &mut vaults, 0)
        .err()
        .expect("the file cannot be written");
    assert!(
        refusal.held,
        "the tick is in the buffer, so the box on screen is right"
    );
    assert!(
        ticking
            .active_edit()
            .expect("the buffer is there")
            .is_dirty(),
        "and the document is dirty, which is what Save is lit over"
    );

    // A table's box, the same way: the splice lands and only the write is refused.
    match edit_block_outcome(
        &mut splicing,
        &table(
            "| a |
",
        ),
    ) {
        BlockEditOutcome::Spliced { autosave, .. } => assert!(autosave, "a tick writes itself"),
        BlockEditOutcome::Refused(why) => panic!("the buffer is seeded: {why}"),
    }
    assert!(
        autosave_active_buffer(&mut splicing, &mut watch, &mut vaults).is_err(),
        "the write is refused, and it is answered rather than only logged"
    );
    assert!(
        splicing
            .active_edit()
            .expect("the buffer is there")
            .is_dirty(),
        "the table's tick is held too, so its box is also right to stay ticked"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// The chrome after a tick the file refused. Cleared, it says the app is holding nothing — beside a box that is plainly ticked and a buffer that really is holding it, which is the reader told to go and make the change again over a document that already has it.
#[test]
fn a_tick_the_file_refused_keeps_its_dirty_mark_rather_than_clearing_the_chrome() {
    let dir =
        scratch_dir("a_tick_the_file_refused_keeps_its_dirty_mark_rather_than_clearing_the_chrome");
    let note = dir.join("tasks.md");
    let source = "- [ ] one
";
    fs::write(&note, source).expect("the note is written");

    let mut workspace = Workspace::default();
    workspace.open_path(note.clone());
    workspace.tabs[0].edit = Some(EditableDocument::new(
        note.clone(),
        SourceText::utf8(source.to_string()),
    ));
    let mut watch = FileWatch::default();
    let mut vaults = VaultState::load(None);
    fs::remove_dir_all(&dir).expect("the folder is deleted under the app");

    let answer = task_toggle_answer(None, &mut workspace, &mut watch, &mut vaults, 0);
    assert!(matches!(answer.chrome, TaskChrome::Resync));
    assert!(answer.held, "the page is told to leave its tick alone");
    let said = answer.said.expect("the reader is told the file is behind");
    assert!(
        said.starts_with("tasks.md was changed and not saved:"),
        "the sentence names the document and says the change is real: {said}"
    );

    let held = workspace.active_edit().expect("the buffer is there");
    assert!(
        editing_state_script(held).contains("\"dirty\":true"),
        "which is what the resync sends: the dot stays up and Save stays lit"
    );
    assert!(
        cleared_editing_state_script().contains("\"dirty\":false"),
        "where clearing it would have put both out over a change the app is holding"
    );

    // And a tick with nothing behind it clears the chrome, which is the other half of the same decision.
    let mut unread = Workspace::default();
    unread.open_path(dir.join("elsewhere").join("tasks.md"));
    let answer = task_toggle_answer(None, &mut unread, &mut watch, &mut vaults, 0);
    assert!(matches!(answer.chrome, TaskChrome::Clear));
    assert!(!answer.held, "so the page puts its own tick back off");
    assert_eq!(
        answer.said.as_deref(),
        Some("tasks.md was not changed: the file could not be read."),
        "and the sentence says nothing happened, because nothing did"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// A vault with one note in it, open in the workspace with an edit buffer holding `typed`, ready to be saved.
fn vault_with_an_open_note(
    label: &str,
    on_disk: &str,
    typed: &str,
) -> (PathBuf, PathBuf, Workspace) {
    let dir = scratch_dir(label);
    let note = dir.join("note.md");
    fs::write(&note, on_disk).expect("the fixture note is written");
    let mut workspace = Workspace::default();
    workspace.open_path(note.clone());
    workspace.tabs[0].edit = Some(EditableDocument::new(
        note.clone(),
        SourceText::utf8(typed.to_string()),
    ));
    (dir, note, workspace)
}

/// Whether the vault's held text — what search, the completion menu and the next map are read out of — carries these words anywhere in it.
fn held_text_has(vaults: &VaultState, words: &str) -> bool {
    vaults
        .corpus
        .as_ref()
        .expect("the vault's text is held")
        .documents
        .iter()
        .any(|document| document.text.contains(words))
}

/// The note somebody just saved is findable straight away. The watcher never brings this one back — the save marks its own event as already seen — so unless Save says so, search answers out of the text the vault was read with.
#[test]
fn saving_the_open_note_replaces_its_searchable_text_at_once() {
    let (dir, note, mut workspace) = vault_with_an_open_note(
        "saving_the_open_note_replaces_its_searchable_text_at_once",
        "# Note\n\nthe words the vault was read with\n",
        "# Note\n\nthe note says dharma\n",
    );
    let root = plain_event_path(fs::canonicalize(&dir).expect("the fixture canonicalizes"));
    let note = plain_event_path(fs::canonicalize(&note).expect("the note canonicalizes"));

    let mut vaults = VaultState::load(None);
    vaults.root = Some(root.clone());
    vaults.corpus = Some(Arc::new(VaultCorpus::read(&root)));
    let mut watch = FileWatch::default();
    let mut book = RefreshBook::default();

    save_active_document(None, &mut workspace, &mut watch, &mut vaults, &mut book)
        .expect("the note is written");

    assert!(
        vaults
            .corpus
            .as_ref()
            .expect("the vault's text is held")
            .documents
            .iter()
            .any(|document| document.text.contains("the note says dharma")),
        "the save was not findable until the vault was read again"
    );
    assert_eq!(
        watch.active_hash,
        Some(content_hash("# Note\n\nthe note says dharma\n")),
        "the save stopped suppressing its own reload"
    );
    assert!(
        !vaults.corpus_changes.contains(&note),
        "a save with no read running was kept instead of read"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// Saved while the vault is still being read, the note waits rather than being patched into text the read owns — and the finished read carries it, once.
#[test]
fn saving_the_open_note_during_a_read_lands_once_when_the_read_ends() {
    let (dir, note, mut workspace) = vault_with_an_open_note(
        "saving_the_open_note_during_a_read_lands_once_when_the_read_ends",
        "# Note\n\nthe words the vault was read with\n",
        "# Note\n\nthe note says dharma\n",
    );
    let root = plain_event_path(fs::canonicalize(&dir).expect("the fixture canonicalizes"));
    let note = plain_event_path(fs::canonicalize(&note).expect("the note canonicalizes"));
    let as_read = CorpusDocument {
        path: note.to_string_lossy().to_string(),
        label: "note".to_string(),
        aliases: Vec::new(),
        text: "# Note\n\nthe words the vault was read with\n".to_string(),
    };

    let mut vaults = VaultState::load(None);
    vaults.root = Some(root.clone());
    vaults.corpus_loading = true;
    let reading = vaults.corpus_read.claim();
    let mut watch = FileWatch::default();
    let mut book = RefreshBook::default();

    save_active_document(None, &mut workspace, &mut watch, &mut vaults, &mut book)
        .expect("the note is written");
    assert!(
        vaults.corpus_changes.contains(&note),
        "a save made mid-read was not kept for the end of it"
    );

    // The read reaches the note it was already walking towards, and hands over the bytes it found before the save.
    let last = absorb_corpus_slice(
        &mut vaults,
        &root,
        vec![as_read],
        false,
        Vec::new(),
        true,
        true,
        reading,
    )
    .expect("the last slice is kept");

    let saved: Vec<&CorpusDocument> = last
        .corpus
        .documents
        .iter()
        .filter(|document| document.text.contains("the note says dharma"))
        .collect();
    assert_eq!(
        saved.len(),
        1,
        "the note saved during the read is missing from the finished vault, or in it twice"
    );
    assert_eq!(
        last.corpus.documents.len(),
        1,
        "the replay added a second row for a file the read had already carried"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// The box somebody just ticked is findable straight away. A tick writes the file itself and marks its own change as already seen, so unless the tick says so, `task:done` answers out of the text the vault was read with and the reader is told nothing is finished.
#[test]
fn ticking_a_box_in_the_open_note_replaces_its_searchable_text_at_once() {
    let source = "# Note

- [ ] wash the kelpstone
";
    let (dir, note, mut workspace) = vault_with_an_open_note(
        "ticking_a_box_in_the_open_note_replaces_its_searchable_text_at_once",
        source,
        source,
    );
    let root = plain_event_path(fs::canonicalize(&dir).expect("the fixture canonicalizes"));
    let note = plain_event_path(fs::canonicalize(&note).expect("the note canonicalizes"));

    let mut vaults = VaultState::load(None);
    vaults.root = Some(root.clone());
    vaults.corpus = Some(Arc::new(VaultCorpus::read(&root)));
    let mut watch = FileWatch::default();

    assert!(
        held_text_has(&vaults, "- [ ] wash the kelpstone"),
        "the vault was read with the box open, which is what the tick has to move"
    );

    flip_task_and_save(None, &mut workspace, &mut watch, &mut vaults, 0)
        .map_err(|refusal| refusal.why)
        .expect("the box is ticked and the file written");

    assert!(
        held_text_has(&vaults, "- [x] wash the kelpstone"),
        "the tick was not findable until the vault was read again"
    );
    assert!(
        !held_text_has(&vaults, "- [ ] wash the kelpstone"),
        "the open box is still there to be found, so task:open answers over a box that is ticked"
    );
    assert!(
        !vaults.corpus_changes.contains(&note),
        "a tick with no read running was kept instead of read"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// A tick the file refused moves nothing. The disk still holds the box open, so patching the held text off a write that never happened is the same staleness pointing the other way — and during a cold read, keeping the path would replay a change that was never made.
#[test]
fn a_tick_the_file_refused_leaves_the_vaults_text_and_its_kept_paths_alone() {
    let source = "# Note

- [ ] wash the kelpstone
";
    let (dir, note, mut workspace) = vault_with_an_open_note(
        "a_tick_the_file_refused_leaves_the_vaults_text_and_its_kept_paths_alone",
        source,
        source,
    );
    let root = plain_event_path(fs::canonicalize(&dir).expect("the fixture canonicalizes"));
    let note = plain_event_path(fs::canonicalize(&note).expect("the note canonicalizes"));

    let mut vaults = VaultState::load(None);
    vaults.root = Some(root.clone());
    vaults.corpus = Some(Arc::new(VaultCorpus::read(&root)));
    let mut watch = FileWatch::default();

    // The owner's own gesture, and the only way the write fails here: the folder goes while the app is still up.
    fs::remove_dir_all(&dir).expect("the folder is deleted under the app");

    let refusal = flip_task_and_save(None, &mut workspace, &mut watch, &mut vaults, 0)
        .err()
        .expect("the file cannot be written");
    assert!(
        refusal.held,
        "the tick is in the buffer, so the box on screen is right"
    );
    assert!(
        held_text_has(&vaults, "- [ ] wash the kelpstone"),
        "the disk still holds the box open, and the vault's text now says otherwise"
    );
    assert!(
        vaults.corpus_changes.is_empty(),
        "a refused tick was kept for the end of a read that would replay a change nobody made"
    );

    // The same refusal while a read is running, which is where a kept path would land in the finished vault.
    vaults.corpus_loading = true;
    flip_task_and_save(None, &mut workspace, &mut watch, &mut vaults, 0)
        .err()
        .expect("the file still cannot be written");
    assert!(
        !vaults.corpus_changes.contains(&note),
        "the refused tick was kept for the end of the read"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// A box inside a table is the one splice in the app that writes itself, and its write hid from the vault's text the same way a tick in a list did. The other half is the rule: a splice that does not auto-save has written no file, so the held text must not move for it.
#[test]
fn a_table_box_that_writes_itself_replaces_the_searchable_text_and_a_plain_splice_does_not() {
    let source = "# Note

| task | who |
| --- | --- |
| [ ] | kelpstone |
";
    let (dir, note, mut workspace) = vault_with_an_open_note(
        "a_table_box_that_writes_itself_replaces_the_searchable_text_and_a_plain_splice_does_not",
        source,
        source,
    );
    let root = plain_event_path(fs::canonicalize(&dir).expect("the fixture canonicalizes"));

    let mut vaults = VaultState::load(None);
    vaults.root = Some(root.clone());
    vaults.corpus = Some(Arc::new(VaultCorpus::read(&root)));
    let mut watch = FileWatch::default();
    assert!(
        held_text_has(&vaults, "| [ ] | kelpstone |"),
        "the vault was read with the cell open, which is what the write has to move"
    );

    // The marker is the whole cell, which is the only shape the reader draws a checkbox over.
    let cell = source.find("[ ]").expect("the fixture holds the open box");
    let splice = |text: &'static str, autosave: bool| BlockEdit {
        start: cell,
        end: cell + 3,
        text,
        autosave,
        live: false,
        continuing: false,
        cell: None,
    };

    match edit_block_outcome(&mut workspace, &splice("[x]", true)) {
        BlockEditOutcome::Spliced { autosave, .. } => assert!(autosave, "a tick writes itself"),
        BlockEditOutcome::Refused(why) => panic!("the buffer is seeded: {why}"),
    }
    autosave_active_buffer(&mut workspace, &mut watch, &mut vaults).expect("the table is written");
    assert!(
        held_text_has(&vaults, "| [x] | kelpstone |"),
        "the ticked cell was not findable until the vault was read again"
    );

    // A splice with auto-save off writes no file, so nothing may reach the vault's text off it. The door reads the disk, so the disk has to say something new or the test cannot tell.
    fs::write(
        &note,
        "# Note

words no splice put here
",
    )
    .expect("the file moves underneath");
    match edit_block_outcome(&mut workspace, &splice("[ ]", false)) {
        BlockEditOutcome::Spliced { autosave, .. } => {
            assert!(!autosave, "this one waits for the reader to save")
        }
        BlockEditOutcome::Refused(why) => panic!("the buffer is seeded: {why}"),
    }
    assert!(
        !held_text_has(&vaults, "words no splice put here"),
        "a splice that wrote no file still sent the vault off to re-read one"
    );

    let _ = fs::remove_dir_all(&dir);
}

/// A reader working down a checklist pays for the vault's text once, not once a box. The first tick copies it only because a worker is off holding the text the vault was read with; what that copy leaves behind is the state's alone, so every tick after it moves that one in place.
#[test]
fn a_second_tick_refreshes_the_copy_the_first_one_left_rather_than_making_another() {
    let source = "# Note

- [ ] wash the kelpstone
- [ ] fold the tideline
";
    let (dir, _note, mut workspace) = vault_with_an_open_note(
        "a_second_tick_refreshes_the_copy_the_first_one_left_rather_than_making_another",
        source,
        source,
    );
    let root = plain_event_path(fs::canonicalize(&dir).expect("the fixture canonicalizes"));

    let mut vaults = VaultState::load(None);
    vaults.root = Some(root.clone());
    vaults.corpus = Some(Arc::new(VaultCorpus::read(&root)));
    let mut watch = FileWatch::default();

    // What search, the map and the completion menu each do with the vault's text: carry it off the loop, holding the very read the state is still pointing at.
    let worker = Arc::clone(vaults.corpus.as_ref().expect("the vault's text is held"));
    let as_read = Arc::as_ptr(&worker);

    if let Err(refused) = flip_task_and_save(None, &mut workspace, &mut watch, &mut vaults, 0) {
        panic!("the fixture is writable: {}", refused.why);
    }
    let after_first = Arc::as_ptr(vaults.corpus.as_ref().expect("the vault's text is held"));
    assert_ne!(
        after_first, as_read,
        "the worker's text was moved under it rather than copied away from"
    );

    // The address rather than another clone: holding one here would itself be a second worker, and what is under test is the tick that has none.
    if let Err(refused) = flip_task_and_save(None, &mut workspace, &mut watch, &mut vaults, 1) {
        panic!("the fixture is still writable: {}", refused.why);
    }
    assert_eq!(
        Arc::as_ptr(vaults.corpus.as_ref().expect("the vault's text is held")),
        after_first,
        "the second tick copied the whole vault's text again, so a reader pays for the copy once a box"
    );

    assert!(
        held_text_has(&vaults, "- [x] wash the kelpstone"),
        "the first tick was not findable until the vault was read again"
    );
    assert!(
        held_text_has(&vaults, "- [x] fold the tideline"),
        "the second tick was not findable until the vault was read again"
    );
    assert!(
        worker
            .documents
            .iter()
            .all(|document| !document.text.contains("- [x]")),
        "the text the worker is reading moved under it while it was reading"
    );

    let _ = fs::remove_dir_all(&dir);
}
