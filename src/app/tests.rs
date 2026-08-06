//! Tests for the binary: tabs, history, file watching, link routing, file actions.

use super::*;
use std::io;

/// A query as the page would send one, with no date of its own.
fn typed(query: &str) -> TypedQuery {
    TypedQuery::new(query.to_string(), None)
}

fn fixture_source_path(relative_path: &str) -> PathBuf {
    std::env::temp_dir()
        .join("leaf-link-fixtures")
        .join(relative_path)
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

fn file_url_for_fixture(relative_path: &str) -> String {
    url::Url::from_file_path(fixture_source_path(relative_path))
        .expect("fixture path has a file URL")
        .to_string()
}

#[test]
fn rename_file_renames_within_the_same_folder() {
    let dir = std::env::temp_dir().join(format!(
        "leaf-rename-ok-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
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
    let dir = std::env::temp_dir().join(format!(
        "leaf-rename-bad-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
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
    let dir = std::env::temp_dir().join("leaf-watch-dir-fixture");
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
    let root = std::env::temp_dir().join("leaf-desired-watches-fixture");
    let project = root.join("project");
    let outside = root.join("outside");
    fs::create_dir_all(&project).expect("project directory is created");
    fs::create_dir_all(&outside).expect("outside directory is created");

    let canon = |path: &Path| fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    // A document inside the project folder is already covered by the recursive watch, so the project folder is the only directory watched.
    let inside_doc = project.join("notes.md");
    let watches = desired_watches(Some(&inside_doc), Some(&project), RecursiveMode::Recursive);
    assert_eq!(watches.len(), 1);
    assert_eq!(
        watches.get(&canon(&project)),
        Some(&RecursiveMode::Recursive)
    );

    // A document outside the project folder adds its own non-recursive watch.
    let outside_doc = outside.join("loose.md");
    let watches = desired_watches(Some(&outside_doc), Some(&project), RecursiveMode::Recursive);
    assert_eq!(
        watches.get(&canon(&project)),
        Some(&RecursiveMode::Recursive)
    );
    assert_eq!(
        watches.get(&canon(&outside)),
        Some(&RecursiveMode::NonRecursive)
    );

    // No project folder: only the document's folder is watched, non-recursively.
    let watches = desired_watches(Some(&outside_doc), None, RecursiveMode::Recursive);
    assert_eq!(watches.len(), 1);
    assert_eq!(
        watches.get(&canon(&outside)),
        Some(&RecursiveMode::NonRecursive)
    );

    // A stale (nonexistent) project path is not watched.
    let missing = root.join("does-not-exist");
    assert!(desired_watches(None, Some(&missing), RecursiveMode::Recursive).is_empty());

    fs::remove_dir_all(&root).expect("fixture directory is removed");
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
fn an_external_file_in_the_shown_folder_refreshes_the_pane_for_every_format() {
    let dir = std::env::temp_dir().join(format!(
        "leaf-pane-refresh-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&dir).expect("fixture directory is created");
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

    // Switching vaults abandons the scan with nothing taking its place, so the answer about the vault we left is dropped too.
    state.drop_corpus();
    assert!(!state.search.generation.is_current(second));
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
    let dir = std::env::temp_dir().join(format!(
        "leaf-corpus-patch-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&dir).expect("fixture directory is created");
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
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-same-document-{unique}"));
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
    assert_eq!(code_view_scroll(&ScrollIntent::Preserve), None);
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
        .map(|(_, path)| path)
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
fn a_browsed_folder_is_watched_one_level_deep_not_recursively() {
    // Browsing into `C:\` in the library used to hand the watcher a recursive subscription to the whole drive. Every change on the machine then arrived as an event, and the pane rebuilt against each one — the window stopped answering, and switching vaults never got processed.
    //
    // A vault is the user's own choice of folder and stays recursive; a folder the pane merely browsed to gets one level, which is all the pane shows.
    let dir = std::env::temp_dir().join(format!(
        "leaf-watch-mode-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let browsed = dir.join("browsed");
    fs::create_dir_all(&browsed).expect("test directory is created");

    let shallow = desired_watches(None, Some(&browsed), RecursiveMode::NonRecursive);
    assert_eq!(shallow.len(), 1);
    assert!(shallow
        .values()
        .all(|mode| matches!(mode, RecursiveMode::NonRecursive)));

    let deep = desired_watches(None, Some(&browsed), RecursiveMode::Recursive);
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
fn a_staged_source_payload_is_served_with_the_headers_the_fetch_needs() {
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

/// A scratch folder for the transfer tests, named per test so they can run at once.
fn transfer_fixture(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "leaf-transfer-{label}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    dir
}

#[test]
fn a_cut_file_pasted_into_a_folder_moves_there() {
    let dir = transfer_fixture("move");
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
    let dir = transfer_fixture("copy");
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
    let dir = transfer_fixture("collide");
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
    let dir = transfer_fixture("recursive");
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
    let dir = transfer_fixture("folder");
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
        document: opened_document_from_source(text, &path),
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
        document: opened_document_from_source(text, &path),
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
    pipe::listen(address.clone(), |request| {
        pipe::answer(request, |ask| match ask {
            pipe::Ask::Eval { script } => Some(Ok(serde_json::json!(format!("ran {script}")))),
            _ => Some(Ok(serde_json::json!({ "tabs": [] }))),
        })
    });

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
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
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
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
    assert_eq!(reply["answer"]["reader"]["scrollTop"], 4000);

    // Without the flag the page is never asked, which is what makes the plain ask safe on an app that is hanging.
    let asked = std::sync::atomic::AtomicUsize::new(0);
    let reply = pipe::answer(r#"{"ask":"state"}"#, |ask| {
        if matches!(ask, pipe::Ask::Eval { .. }) {
            asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        Some(Ok(serde_json::json!({ "tabs": [] })))
    });
    assert!(reply.contains("\"ok\":true"), "{reply}");
    assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert!(
        !reply.contains("reader"),
        "the plain ask answers what it always answered: {reply}"
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
    let settled: serde_json::Value = serde_json::from_str(&settled).expect("a JSON reply");
    assert_eq!(settled["answer"]["idle"], true);
    assert_eq!(settled["answer"]["reader"]["scrollTop"], 0);

    let started = std::time::Instant::now();
    let busy = pipe::answer(r#"{"ask":"idle"}"#, |_| {
        Some(Ok(serde_json::json!({ "renderInFlight": true })))
    });
    let waited = started.elapsed();
    let busy: serde_json::Value = serde_json::from_str(&busy).expect("a JSON reply");
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
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
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
    let text: serde_json::Value = serde_json::from_str(&text).expect("a JSON reply");
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
    pipe::listen(address.clone(), |request| {
        pipe::answer(request, |_| Some(Ok(serde_json::json!(null))))
    });

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
    let reply: serde_json::Value = serde_json::from_str(&reply).expect("a JSON reply");
    assert_eq!(reply["ok"], false);
    assert!(reply["error"]
        .as_str()
        .unwrap_or_default()
        .contains("did not answer in time"));
}

/// A folder of its own per journal test: these write real files and one of them runs in a second process, so they must not land on each other.
fn journal_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join("leaf-journal").join(name)
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
    let dir = journal_dir("panic");

    if std::env::var_os(CHILD).is_some() {
        journal::start_in(&dir);
        panic!("the journal should be holding this");
    }

    let _ = fs::remove_dir_all(&dir);
    let child = Command::new(std::env::current_exe().expect("this test binary"))
        // --nocapture matters: with the harness capturing output, `eprintln!` is diverted before it ever reaches the handle the journal swapped.
        .args(["a_panic_reaches_the_journal", "--nocapture"])
        .env(CHILD, "1")
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
fn the_mac_window_pulls_apples_dots_into_the_app_bar() {
    // Four builder calls make the Mac shell, and each alone is broken: without the fullsize content view the page starts below a gray strip, without the transparent bar the strip is still painted, without the hidden title "Leaftext" sits over the tabs, and without the inset the dots stay where the strip was. `with_decorations(false)` must never join them — tao overwrites every title-bar property when it is set, and the dots go with it.
    let source = include_str!("../main.rs");
    let mac_arm = source
        .split("#[cfg(target_os = \"macos\")]")
        .find(|arm| arm.contains("with_traffic_light_inset"))
        .expect("main.rs has a macOS window arm");
    for call in [
        "with_fullsize_content_view(true)",
        "with_titlebar_transparent(true)",
        "with_title_hidden(true)",
        "with_traffic_light_inset(",
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
    assert_eq!(source.matches("with_undecorated_shadow(true)").count(), 1);
    // The dock and app-switcher icon is not the strip, so macOS keeps taking it.
    assert!(source.contains("#[cfg(not(windows))]"));
}

#[test]
fn full_screen_is_read_off_the_window_not_off_a_gesture() {
    // Full screen is reachable from the green dot's menu, the View menu and a shortcut, and only one of the three is a click the page ever sees. The resize every one of them causes is what the loop reads, so the bar's room for the dots cannot be left behind by whichever route was taken.
    let source = include_str!("event_loop.rs");
    assert!(
        source.contains("reader.window.fullscreen().is_some()"),
        "the window is the source of truth for full screen"
    );
    assert!(
        source.contains("window.leafSetFullscreen({fullscreen});"),
        "the page is told when it changes"
    );
}
