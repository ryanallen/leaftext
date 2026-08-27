//! What the watcher reports, what it refuses at its boundary, and what a change makes the app redraw.

use super::*;

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
    let nothing_open: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    assert_eq!(
        watched_change(PathBuf::from(r"\\?\C:\notes\mail.eml"), &nothing_open),
        Some(PathBuf::from(r"C:\notes\mail.eml")),
        "the debouncer must translate event paths before sending them"
    );

    // And the two it refuses are refused here rather than in an arm: both cost the loop's whole tail, and one of them is the app answering its own write.
    assert_eq!(
        watched_change(PathBuf::from("/vault/.git/index"), &nothing_open),
        None,
        "git's own bookkeeping reached the loop"
    );
    assert_eq!(
        watched_change(
            PathBuf::from("/vault/site/node_modules/pkg/index.js"),
            &nothing_open
        ),
        None,
        "a machine's build output reached the loop"
    );

    // The document being read is the one exception, and it stays one at the boundary.
    let reading_in: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(Some(PathBuf::from(
        "/vault/site/node_modules/pkg",
    ))));
    assert_eq!(
        watched_change(
            PathBuf::from("/vault/site/node_modules/pkg/README.md"),
            &reading_in
        ),
        Some(PathBuf::from("/vault/site/node_modules/pkg/README.md")),
        "a README opened out of a generated folder stopped live-reloading"
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
fn only_a_document_that_moved_redraws_the_map() {
    // A vault is a folder someone works in: the watcher reports `.git` writing an index, a saved image, a temp file coming and going. None of them can change the corpus, so none of them may reach the page as a fresh graph.
    let mut state = VaultState::load(None);
    state.root = Some(PathBuf::from("/vault"));
    state.corpus = Some(Arc::new(VaultCorpus {
        root: PathBuf::from("/vault"),
        documents: vec![CorpusDocument {
            path: "/vault/note.md".to_string(),
            label: "note".to_string(),
            aliases: Vec::new(),
            text: "a talk on dharma".to_string(),
        }],
        truncated: false,
        skipped: Vec::new(),
    }));

    // A path the vault's text does not cover is answered before anything is paid for: `Arc::make_mut` clones the whole vault's text when a worker is mid-build, so a worker holding it is what makes the cost visible.
    let worker_holds = Arc::clone(state.corpus.as_ref().expect("the vault has text"));
    for uninteresting in [
        "/vault/.git/index",
        "/elsewhere/note.md",
        "/vault/picture.png",
    ] {
        assert!(
            !patch_vault_corpus(&mut state, Path::new(uninteresting)),
            "{uninteresting} moved the vault's text"
        );
        assert!(
            Arc::ptr_eq(
                &worker_holds,
                state.corpus.as_ref().expect("the text is still held")
            ),
            "{uninteresting} cost a copy of the whole vault's text while a worker was reading it"
        );
    }

    // And the answer it gives gates the redraw: the vault's text is a cache, so "nothing moved" means the map on screen cannot have changed.
    state.last_graph = Some(PendingGraph {
        document: None,
        request: GraphRequest::default(),
    });
    assert!(
        matches!(
            corpus_change_redraw(&mut state, Path::new("/vault/.git/index"), true),
            GraphRedraw::Nothing
        ),
        "a refresh that changed nothing reached the vault graph rebuild"
    );

    // A document's own map has no cache to compare against, so it cannot answer that question — but it still refuses to redraw for a path that is not a document at all, which is most of what the watcher reports.
    state.last_graph = Some(PendingGraph {
        document: Some(PathBuf::from("/vault/note.md")),
        request: GraphRequest::default(),
    });
    assert!(
        matches!(
            corpus_change_redraw(&mut state, Path::new("/vault/.git/index"), true),
            GraphRedraw::Nothing
        ),
        "a document map rebuilt for a path that is not a document"
    );
    assert!(
        matches!(
            corpus_change_redraw(&mut state, Path::new("/vault/other.md"), true),
            GraphRedraw::Document { .. }
        ),
        "a document map stopped rebuilding for a document that could be in the picture"
    );

    // And a map nobody is looking at is never rebuilt, whatever moved.
    assert!(matches!(
        corpus_change_redraw(&mut state, Path::new("/vault/other.md"), false),
        GraphRedraw::Nothing
    ));
}
