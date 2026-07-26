//! Tests for the binary: tabs, history, file watching, link routing, file actions.

use super::*;
use std::io;

fn fixture_source_path(relative_path: &str) -> PathBuf {
    std::env::temp_dir()
        .join("leaf-link-fixtures")
        .join(relative_path)
}

#[test]
fn a_staged_update_installs_itself_at_launch_but_only_once() {
    // The whole point of the updater: a version downloaded last session is
    // installed on the next launch, with nothing for the user to click.
    let mut settings = Settings {
        auto_update_enabled: true,
        update_staged_version: "0.1.400".to_string(),
        update_auto_applied: String::new(),
        ..Settings::default()
    };
    assert!(should_auto_apply(&settings, true));

    // Recorded before the installer runs, so an installer that fails silently
    // is attempted once and then left to the button — not retried on every
    // launch, which would be a boot loop.
    settings.update_auto_applied = "0.1.400".to_string();
    assert!(!should_auto_apply(&settings, true));

    // A newer download supersedes the failed one and gets its own attempt.
    settings.update_staged_version = "0.1.401".to_string();
    assert!(should_auto_apply(&settings, true));

    // Nothing on disk, nothing staged, or the user turned it off.
    assert!(!should_auto_apply(&settings, false));
    settings.update_staged_version.clear();
    assert!(!should_auto_apply(&settings, true));
    settings.update_staged_version = "0.1.401".to_string();
    settings.auto_update_enabled = false;
    assert!(!should_auto_apply(&settings, true));
}

#[test]
fn a_landed_update_clears_the_one_attempt_guard() {
    // Once the staged record is gone the install worked, so the next download
    // must not inherit a guard that blocks its automatic attempt.
    let mut settings = Settings {
        update_staged_version: String::new(),
        update_auto_applied: "0.1.400".to_string(),
        ..Settings::default()
    };
    // reconcile_staged_update needs the data dir; assert the narrow rule it
    // enforces rather than reaching into the filesystem.
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

    // Empty, dot entries, and any path separator are refused so a rename can
    // never move the file or escape its folder.
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

    assert!(message.contains("Leaf Text could not start."));
    assert!(message.contains("webview runtime missing"));
    assert!(message.contains("Microsoft Edge WebView2 Runtime"));
}

#[test]
fn startup_failure_message_identifies_webview_access_denied() {
    let error = io::Error::new(io::ErrorKind::PermissionDenied, "Access is denied.");
    let message = startup_failure_message(&error);

    assert!(message.contains("Leaf Text could not start."));
    assert!(message.contains("Access is denied."));
    assert!(message.contains("per-user browser data folder"));
    assert!(message.contains("webview2"));
    assert!(!message.contains("Microsoft Edge WebView2 Runtime"));
}

#[test]
fn content_hash_distinguishes_changed_documents() {
    // Same contents hash equal (so the live-reload path skips a no-op
    // re-render); a single-character edit changes the hash (so a real save
    // is not mistaken for a duplicate event).
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

    // A bare filename has no usable parent, so nothing is watched (we never
    // fall back to watching a huge ancestor directory).
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

    // A document inside the project folder is already covered by the recursive
    // watch, so the project folder is the only directory watched.
    let inside_doc = project.join("notes.md");
    let watches = desired_watches(Some(&inside_doc), Some(&project));
    assert_eq!(watches.len(), 1);
    assert_eq!(
        watches.get(&canon(&project)),
        Some(&RecursiveMode::Recursive)
    );

    // A document outside the project folder adds its own non-recursive watch.
    let outside_doc = outside.join("loose.md");
    let watches = desired_watches(Some(&outside_doc), Some(&project));
    assert_eq!(
        watches.get(&canon(&project)),
        Some(&RecursiveMode::Recursive)
    );
    assert_eq!(
        watches.get(&canon(&outside)),
        Some(&RecursiveMode::NonRecursive)
    );

    // No project folder: only the document's folder is watched, non-recursively.
    let watches = desired_watches(Some(&outside_doc), None);
    assert_eq!(watches.len(), 1);
    assert_eq!(
        watches.get(&canon(&outside)),
        Some(&RecursiveMode::NonRecursive)
    );

    // A stale (nonexistent) project path is not watched.
    let missing = root.join("does-not-exist");
    assert!(desired_watches(None, Some(&missing)).is_empty());

    fs::remove_dir_all(&root).expect("fixture directory is removed");
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
        history.entries,
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

    // The failed entry is removed entirely, not left in forward history, so
    // the user can't step forward back onto it.
    assert!(history.forget_current());
    assert_eq!(history.current(), Some(&PathBuf::from("good.md")));
    assert_eq!(history.entries, vec![PathBuf::from("good.md")]);
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

/// Build a distinct anchor for scroll-history tests; the block ordinal keeps
/// the entries identifiable.
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
    tab.edit_buffer(&first, "# A\n".to_string()).toggle_task(0);
    assert!(tab.has_edit_for(&first));
    assert!(!tab.needs_edit_seed(&first));

    // The buffer is NOT the second document's: rendering b.md must not use
    // it (the stale-buffer bug that made link navigation re-render the old
    // page), and editing b.md must re-seed from b's contents.
    assert!(!tab.has_edit_for(&second));
    assert!(tab.needs_edit_seed(&second));
    let edit = tab.edit_buffer(&second, "# B\n".to_string());
    assert_eq!(edit.text(), "# B\n");
    assert!(tab.has_edit_for(&second));
    assert!(!tab.has_edit_for(&first));

    // Re-editing the same document reuses the buffer (unsaved edits kept).
    let edit = tab.edit_buffer(&second, String::new());
    edit.replace_range(2, 3, "Bee");
    assert_eq!(edit.text(), "# Bee\n");
    let edit = tab.edit_buffer(&second, String::new());
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
