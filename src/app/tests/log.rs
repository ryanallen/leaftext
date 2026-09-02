//! The log the app writes, and what survives a crash.

use super::*;

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
fn only_the_close_that_saves_takes_the_run_marker_away() {
    // The whole point of the marker: after a kill there is nothing else on the next launch that tells a crash from a quit, so its answer has to be exact in both directions.
    let dir = journal_dir("run-marker");
    let _ = fs::remove_dir_all(&dir);

    assert!(
        !journal::arm_run_in(&dir),
        "a first launch found a marker nobody left"
    );
    assert!(
        journal::run_marker_path(&dir).is_file(),
        "the launch did not leave its marker"
    );

    // A run that never reached the close: the marker is still there, and the next launch says so.
    assert!(
        journal::arm_run_in(&dir),
        "a launch after an unexpected end reported a clean one"
    );

    // And the close that saves is what makes the next launch clean again.
    journal::clear_run_marker_in(&dir);
    assert!(
        !journal::run_marker_path(&dir).is_file(),
        "the saved close left its marker behind"
    );
    assert!(
        !journal::arm_run_in(&dir),
        "a launch after a saved close reported an unexpected end"
    );

    // Clearing a marker that is already gone is the ordinary second close of a session that crashed once, not a failure.
    journal::clear_run_marker_in(&dir);
}

#[test]
fn a_folder_that_cannot_hold_the_run_marker_does_not_stop_the_app() {
    // Instrumentation never takes the app down — the same trade `start_in` makes. A file sitting where the data folder should be is the portable version of "you cannot write here", and the launch has to read that as a clean start rather than growling about a crash that never happened.
    let dir = journal_dir("run-marker-blocked");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.parent().expect("a parent")).expect("a temp folder");
    fs::write(&dir, "not a folder").expect("a file in the way");

    assert!(
        !journal::arm_run_in(&dir),
        "a folder that cannot be written claimed the last run crashed"
    );
    journal::clear_run_marker_in(&dir);
}

#[test]
fn the_marker_is_armed_after_both_returns_and_cleared_before_the_loop_stops() {
    // Two orderings the marker's answer rests on, and neither is visible from a running test: armed too early it fires on a forwarded copy and on the copy that hands off an update, so a reader who opened a second window would be told the app had crashed; cleared after the exit, or from anywhere but the one saved close, and a real crash reads as a clean quit.
    let launch = include_str!("../../main.rs");
    let forwarded = launch
        .find("single_instance::Acquire::Forwarded => return Ok(())")
        .expect("the forwarded-copy return");
    let handoff = launch
        .find("if auto_apply_staged_update(")
        .expect("the update handoff");
    let armed = launch
        .find("journal::arm_run()")
        .expect("the marker being armed");
    let loop_built = launch
        .find("let event_loop = EventLoopBuilder")
        .expect("the event loop being built");
    assert!(
        forwarded < armed && handoff < armed,
        "the marker is armed before the launch knows this copy owns the window"
    );
    assert!(
        armed < loop_built,
        "the marker is armed after the window exists"
    );

    let close = include_str!("../event_loop.rs");
    let body = close
        .split_once("fn shut_down(")
        .expect("the one saved close")
        .1;
    let saved = body
        .find("persist_settings(")
        .expect("the session being saved");
    let cleared = body
        .find("clear_run_marker()")
        .expect("the marker being cleared");
    let exit = body
        .find("ControlFlow::Exit")
        .expect("the loop being stopped");
    assert!(
        saved < cleared && cleared < exit,
        "the saved close clears the marker outside the window between saving and exiting"
    );
    assert_eq!(
        close.matches("clear_run_marker").count(),
        1,
        "something other than the one saved close clears the marker"
    );
}

#[test]
fn the_launch_hands_the_page_a_boolean_either_way() {
    // The page reads the flag as a plain truth test, so an absent one and a false one would behave the same — right up until a launch after a crash, where a missing flag reads as a clean start and the one sentence this ticket exists for is never said. Both spellings are pinned, and both are the JavaScript words rather than Rust's.
    assert_eq!(
        unexpected_close_script(true),
        "window.__leafClosedUnexpectedly = true;"
    );
    assert_eq!(
        unexpected_close_script(false),
        "window.__leafClosedUnexpectedly = false;"
    );
}
