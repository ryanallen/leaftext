//! Every ask the pipe answers, and the sentences it refuses with.

use super::*;

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

/// The two sentences the ask pipe refuses with, which nothing in the tree read. They are deliberately not the window's: somebody reading text has no growl to look at, so the path and the operating system's own words go in the answer and nothing goes in the log, where the window's copy does the exact opposite. One walk is about to seed both sides, and it must move neither.
#[test]
fn the_pipes_refusals_name_the_file_and_the_operating_systems_words_and_write_no_log_line() {
    // The log half runs in a second copy of this binary: the journal's redirect is process-wide, so started here it would swallow every other test's output.
    const CHILD: &str = "LEAFTEXT_PIPE_REFUSAL_CHILD";
    let opened_over = |path: &Path| {
        let mut workspace = Workspace::default();
        workspace.open_path(path.to_path_buf());
        workspace
    };
    // Any fingerprint at all: the read fails long before one is compared.
    let unread = "0000000000000000";

    if let Some(handed_over) = std::env::var_os(CHILD) {
        let dir = PathBuf::from(&handed_over);
        journal::start_in(&dir);
        let gone = dir.join("gone.md");
        let _ = pipe_save_document(
            None,
            &mut opened_over(&gone),
            &mut FileWatch::default(),
            &VaultState::load(None),
            &mut RefreshBook::default(),
            &gone,
            unread,
        );
        // The window's door into the same missing file, so the one line in the journal proves the journal was catching anything at all.
        let _ = enter_code_view(None, &mut opened_over(&gone), None);
        return;
    }

    // Nothing open at all is the one arm both sides already word the same way.
    assert_eq!(
        pipe_document_answer(&mut Workspace::default()),
        Err("no document is open".to_string()),
        "the pipe says nothing is open rather than answering for an empty document"
    );

    let dir = scratch_dir("the_pipes_refusals_name_the_file_and_the_operating_systems_words");
    let gone = dir.join("gone.md");
    let refusal = pipe_save_document(
        None,
        &mut opened_over(&gone),
        &mut FileWatch::default(),
        &VaultState::load(None),
        &mut RefreshBook::default(),
        &gone,
        unread,
    )
    .expect_err("there is no file at that path");
    assert!(
        refusal.starts_with(&format!("{} could not be read: ", gone.display())),
        "the answer names the file the asker cannot see for themselves: {refusal}"
    );
    assert!(
        refusal.contains("os error 2"),
        "and carries the operating system's own words, which the window's growl deliberately leaves out: {refusal}"
    );

    let logging = journal_dir("pipe-refusal");
    let _ = fs::remove_dir_all(&logging);
    let child = Command::new(std::env::current_exe().expect("this test binary"))
        // --nocapture matters: with the harness capturing output, `eprintln!` is diverted before it ever reaches the handle the journal swapped.
        .args([
            "the_pipes_refusals_name_the_file_and_the_operating_systems_words_and_write_no_log_line",
            "--nocapture",
        ])
        .env(CHILD, &logging)
        .output()
        .expect("a second copy of the test binary");
    assert!(
        child.status.success(),
        "the child run failed: {}",
        String::from_utf8_lossy(&child.stdout)
    );
    let written = fs::read_to_string(journal::log_path(&logging)).expect("a journal file");
    assert_eq!(
        written.matches("Editing: failed to read").count(),
        1,
        "one line for two refused reads of the same missing file: the window's, because the pipe's diagnosis rides in the answer instead: {written:?}"
    );

    let _ = fs::remove_dir_all(&logging);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_wrapper_carries_the_script_through_and_marks_the_window_after_it() {
    // The two things that would break the answer if they were wrong: the caller's line must arrive untouched, and the mark must be a declaration rather than an assignment, because an assignment is the last expression in the block and would be handed back in place of the answer.
    let wrapped = eval_ask::wrapped_script("1+1 // a trailing comment", 7);
    assert!(
        wrapped.contains("1+1 // a trailing comment\n;const __leafMark"),
        "the script goes in untouched, with a newline before the mark so a comment cannot swallow it: {wrapped}"
    );
    assert!(
        wrapped.starts_with("try { 1+1"),
        "the script is the first thing in the try, so its value is the block's: {wrapped}"
    );
    assert!(
        wrapped.contains("leafEvalError: 7"),
        "the catch tags this ask's own number, which the caller has no way to guess: {wrapped}"
    );
    assert!(
        eval_ask::mark_probe().contains("window.__leafEvalRan"),
        "the second call reads back the mark the first one leaves"
    );
}

#[test]
fn a_line_that_worked_answers_what_it_came_to_even_when_that_is_nothing() {
    // The whole cost of the wrapper is meant to be zero, so every honest answer has to come back exactly as it did before — including the two that look like the failures.
    let mark = serde_json::json!("7");
    assert_eq!(
        eval_ask::outcome(serde_json::json!(2), &mark, 7),
        Ok(serde_json::json!(2))
    );
    // A script that really evaluated to nothing. Told from one that never ran only by the mark.
    assert_eq!(
        eval_ask::outcome(serde_json::Value::Null, &mark, 7),
        Ok(serde_json::Value::Null)
    );
    // The caller's own object carrying the same key. It is not this ask's number, so it is a value.
    let theirs = serde_json::json!({ "leafEvalError": 3, "message": "mine" });
    assert_eq!(eval_ask::outcome(theirs.clone(), &mark, 7), Ok(theirs));
}

#[test]
fn a_line_that_threw_answers_the_engines_own_words() {
    // The failure the engine gives no message for on its own: the mark stands still because the catch ran instead of the declaration, and the message rides back in the reply.
    let thrown = serde_json::json!({
        "leafEvalError": 7,
        "message": "Error: boom\n    at <anonymous>:1:13",
    });
    let answer = eval_ask::outcome(thrown, &serde_json::json!("6"), 7);
    assert_eq!(
        answer,
        Err("Error: boom\n    at <anonymous>:1:13".to_string())
    );
}

#[test]
fn a_line_the_page_never_read_says_so_rather_than_answering_nothing() {
    // A syntax error hands the engine no message at all, so the mark standing still is the only thing that tells this from a script that honestly came to nothing.
    let answer = eval_ask::outcome(serde_json::Value::Null, &serde_json::json!("6"), 7);
    let Err(said) = answer else {
        panic!("a script the page never read must be a failure, not an answer");
    };
    assert!(
        said.contains("never read the script"),
        "the reply has to name what happened, since there is no engine message to quote: {said}"
    );
}

#[test]
fn the_two_calls_answer_once_whichever_order_they_land_in() {
    // The bug this shape is easiest to write wrong: testing the two halves by reading them out empties the first one on the way past, so the second finds nothing waiting and the ask times out at two seconds having answered nothing at all. Both orders, because the web view picks its own thread for each callback.
    let mut join = eval_ask::Join::default();
    assert_eq!(join.fill(Some(serde_json::json!(2)), None), None);
    assert_eq!(
        join.fill(None, Some(serde_json::json!("7"))),
        Some((serde_json::json!(2), serde_json::json!("7")))
    );
    // And never twice: the reply channel holds one answer, and a second would be the wrong ask's.
    assert_eq!(join.fill(None, Some(serde_json::json!("7"))), None);

    let mut join = eval_ask::Join::default();
    assert_eq!(join.fill(None, Some(serde_json::json!("7"))), None);
    assert_eq!(
        join.fill(Some(serde_json::Value::Null), None),
        Some((serde_json::Value::Null, serde_json::json!("7")))
    );
}
