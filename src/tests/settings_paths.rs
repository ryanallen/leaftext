//! Settings, recent files, the format table, and on-disk locations.

use super::*;

use crate::pager::{is_pager_page_extension, pager_label};
use crate::remote::vault_mirror_dir;

#[test]
fn opening_document_records_recent_file_and_persists_it() {
    let dir = scratch_dir("open-document");
    let document_path = dir.join("Guide.md");
    let config_path = dir.join("settings").join("recent-files.json");
    fs::write(&document_path, "# Guide\n\nReadable.").expect("test markdown is written");

    let mut recent = RecentFiles::default();
    let result = open_document_with_recent(&document_path, &mut recent, Some(&config_path))
        .expect("document opens");

    assert_eq!(result.document.title, "Guide");
    assert!(result.recent_save_error.is_none());
    assert_eq!(recent.files, vec![document_path.clone()]);
    assert_eq!(load_recent_files(&config_path).files, vec![document_path]);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn opening_missing_document_returns_typed_error_without_changing_recent_files() {
    let path = scratch_dir("missing-document").join("document.md");
    let mut recent = RecentFiles {
        files: vec![PathBuf::from("already-open.md")],
    };

    let error =
        open_document_with_recent(&path, &mut recent, None).expect_err("missing file fails");

    assert_eq!(error.path(), path.as_path());
    assert_eq!(error.reason().kind(), io::ErrorKind::NotFound);
    assert_eq!(recent.files, vec![PathBuf::from("already-open.md")]);
}

#[test]
fn forget_removes_a_recent_entry_and_reports_whether_it_was_present() {
    let mut recent = RecentFiles {
        files: vec![PathBuf::from("kept.md"), PathBuf::from("gone.md")],
    };

    assert!(recent.forget(Path::new("gone.md")));
    assert_eq!(recent.files, vec![PathBuf::from("kept.md")]);
    // Forgetting something already absent is a no-op and reports false.
    assert!(!recent.forget(Path::new("gone.md")));
    assert_eq!(recent.files, vec![PathBuf::from("kept.md")]);
}

#[test]
fn recent_file_save_error_is_returned_without_blocking_open_document() {
    let dir = scratch_dir("recent-save-error");
    let document_path = dir.join("Release.md");
    fs::write(&document_path, "# Release\n\nStill opens.").expect("test markdown is written");

    let mut recent = RecentFiles::default();
    let result = open_document_with_recent(&document_path, &mut recent, Some(&dir))
        .expect("document open succeeds when recent save fails");
    let save_error = result
        .recent_save_error
        .expect("recent save error is reported");

    assert_eq!(result.document.title, "Release");
    assert_eq!(recent.files, vec![document_path]);
    assert_eq!(save_error.config_path, dir);

    fs::remove_dir_all(save_error.config_path).expect("test directory is removed");
}

#[test]
fn recent_record_collapses_equivalent_path_spellings() {
    let mut recent = RecentFiles::default();

    // `app/README.md` and `app/.tmp/../README.md` resolve to the same file.
    let clean = Path::new("app").join("README.md");
    let messy = Path::new("app").join(".tmp").join("..").join("README.md");
    recent.record(clean.clone());
    recent.record(messy);

    // Both spellings resolve to the same file, so only one entry remains.
    assert_eq!(recent.files, vec![clean]);
}

#[test]
fn normalize_entries_collapses_existing_duplicate_spellings_on_load() {
    let app_readme = Path::new("app").join("README.md");
    let dharma_readme = Path::new("dharma").join("README.md");
    let mut recent = RecentFiles {
        files: vec![
            Path::new("app").join(".tmp").join("..").join("README.md"),
            dharma_readme.clone(),
            app_readme.clone(),
        ],
    };

    recent.normalize_entries();

    // The two spellings of app/README.md collapse, keeping first-seen order.
    assert_eq!(recent.files, vec![app_readme, dharma_readme]);
}

#[test]
fn recent_files_are_deduplicated_and_limited() {
    let mut recent = RecentFiles::default();

    // One past the cap, so the oldest is the one that has to go.
    for index in 0..=MAX_RECENT_FILES {
        recent.record(PathBuf::from(format!("file-{index}.md")));
    }
    recent.record(PathBuf::from("file-5.md"));

    assert_eq!(recent.files.first(), Some(&PathBuf::from("file-5.md")));
    assert_eq!(recent.files.len(), MAX_RECENT_FILES);
    assert_eq!(MAX_RECENT_FILES, 50);
    // Deep enough that yesterday's reading is still in it: the first file opened is what falls off, not the ninth.
    assert!(!recent.files.contains(&PathBuf::from("file-0.md")));
    assert!(recent.files.contains(&PathBuf::from("file-1.md")));
    assert_eq!(
        recent
            .files
            .iter()
            .filter(|path| path.as_os_str() == "file-5.md")
            .count(),
        1
    );
}

#[test]
fn recent_files_persistence_round_trips_and_falls_back_safely() {
    let dir = scratch_dir("recent-persistence");
    let config_path = dir.join("settings").join("recent-files.json");
    let missing_path = dir.join("missing.json");

    let mut recent = RecentFiles::default();
    recent.record(PathBuf::from("first.md"));
    recent.record(PathBuf::from("second.md"));

    save_recent_files(&config_path, &recent).expect("recent files save");
    assert_eq!(load_recent_files(&config_path), recent);
    assert_eq!(load_recent_files(&missing_path), RecentFiles::default());

    fs::write(&config_path, "{not json").expect("corrupt recent files fixture is written");
    assert_eq!(load_recent_files(&config_path), RecentFiles::default());

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn favorites_round_trip_through_the_file_recent_files_uses() {
    let dir = scratch_dir("favorites-persistence");
    let config_path = dir.join("settings").join("recent-files.json");

    let mut favorites = Favorites::default();
    favorites.add(Favorite {
        vault_id: Some(3),
        path: PathBuf::from("notes/daily.md"),
        kind: FavoriteKind::Document,
    });
    favorites.add(Favorite {
        vault_id: Some(3),
        path: PathBuf::from("notes/archive"),
        kind: FavoriteKind::Folder,
    });
    // Something opened from outside every vault is kept, not refused.
    favorites.add(Favorite {
        vault_id: None,
        path: PathBuf::from("desktop/scratch.md"),
        kind: FavoriteKind::Document,
    });

    let mut recent = RecentFiles::default();
    recent.record(PathBuf::from("notes/daily.md"));
    save_recent_files(&config_path, &recent).expect("recent files save");
    save_favorites(&config_path, &favorites).expect("favorites save");

    // Both lists share the file, so saving one keeps the other.
    assert_eq!(load_favorites(&config_path), favorites);
    assert_eq!(load_recent_files(&config_path), recent);
    assert_eq!(
        load_favorites(&dir.join("missing.json")),
        Favorites::default()
    );

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn favorites_collapse_equivalent_path_spellings() {
    let mut favorites = Favorites::default();
    let clean = Path::new("app").join("README.md");
    let messy = Path::new("app").join(".tmp").join("..").join("README.md");

    assert!(favorites.add(Favorite {
        vault_id: Some(1),
        path: clean.clone(),
        kind: FavoriteKind::Document,
    }));
    // The same file under another spelling is already kept, so it is not added twice.
    assert!(!favorites.add(Favorite {
        vault_id: Some(1),
        path: messy.clone(),
        kind: FavoriteKind::Document,
    }));
    assert_eq!(favorites.entries.len(), 1);
    assert!(favorites.contains(&messy));
    assert!(favorites.remove(&messy));
    assert!(!favorites.contains(&clean));
}

#[test]
fn favorites_load_empty_from_a_config_file_written_before_them() {
    let dir = scratch_dir("favorites-older-config");
    let config_path = dir.join("settings").join("recent-files.json");
    fs::create_dir_all(config_path.parent().expect("config folder"))
        .expect("test directory is created");
    fs::write(&config_path, r#"{"files":["guide.md"]}"#).expect("older config fixture is written");

    assert_eq!(load_favorites(&config_path), Favorites::default());
    assert_eq!(
        load_recent_files(&config_path).files,
        vec![PathBuf::from("guide.md")]
    );

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn removing_a_vault_forgets_only_its_own_favorites() {
    let mut favorites = Favorites::default();
    for (vault_id, path) in [
        (Some(1), "work/plan.md"),
        (Some(2), "personal/journal.md"),
        (None, "desktop/scratch.md"),
    ] {
        favorites.add(Favorite {
            vault_id,
            path: PathBuf::from(path),
            kind: FavoriteKind::Document,
        });
    }

    assert!(favorites.forget_vault(1));
    assert_eq!(
        favorites
            .entries
            .iter()
            .map(|kept| kept.path.clone())
            .collect::<Vec<_>>(),
        vec![
            PathBuf::from("personal/journal.md"),
            PathBuf::from("desktop/scratch.md"),
        ]
    );
    // A vault with nothing kept in it reports no change, so nothing is saved.
    assert!(!favorites.forget_vault(1));
}

#[test]
fn favorites_reorder_moves_one_entry_and_ignores_an_index_it_does_not_have() {
    let mut favorites = Favorites::default();
    for path in ["first.md", "second.md", "third.md"] {
        favorites.add(Favorite {
            vault_id: None,
            path: PathBuf::from(path),
            kind: FavoriteKind::Document,
        });
    }

    assert!(favorites.reorder(2, 0));
    assert_eq!(
        favorites
            .entries
            .iter()
            .map(|kept| kept.path.clone())
            .collect::<Vec<_>>(),
        vec![
            PathBuf::from("third.md"),
            PathBuf::from("first.md"),
            PathBuf::from("second.md"),
        ]
    );
    assert!(!favorites.reorder(0, 9));
    assert!(!favorites.reorder(1, 1));
}

#[test]
fn repointing_a_favorite_keeps_its_place_in_the_order() {
    let mut favorites = Favorites::default();
    for path in ["first.md", "second.md", "third.md"] {
        favorites.add(Favorite {
            vault_id: Some(1),
            path: PathBuf::from(path),
            kind: FavoriteKind::Document,
        });
    }

    // The middle entry moved to another folder — and to another vault with it.
    let moved = Path::new("archive")
        .join(".tmp")
        .join("..")
        .join("second.md");
    assert!(favorites.repoint(Path::new("second.md"), &moved, Some(2)));
    assert_eq!(
        favorites
            .entries
            .iter()
            .map(|kept| kept.path.clone())
            .collect::<Vec<_>>(),
        vec![
            PathBuf::from("first.md"),
            // Normalized on the way in, like every other path the store takes.
            Path::new("archive").join("second.md"),
            PathBuf::from("third.md"),
        ]
    );
    assert_eq!(favorites.entries[1].vault_id, Some(2));

    // A path the list does not hold changes nothing: an answer about a row that has since been dropped must not put one back.
    assert!(!favorites.repoint(Path::new("gone.md"), Path::new("found.md"), None));
    assert_eq!(favorites.entries.len(), 3);

    // Pointed at a file the list already keeps: one path, kept once, and the entry that was already there keeps its own place.
    assert!(favorites.repoint(Path::new("third.md"), Path::new("first.md"), Some(1)));
    assert_eq!(
        favorites
            .entries
            .iter()
            .map(|kept| kept.path.clone())
            .collect::<Vec<_>>(),
        vec![
            PathBuf::from("first.md"),
            Path::new("archive").join("second.md"),
        ]
    );
}

#[test]
fn a_drop_names_the_rows_it_lands_between_rather_than_their_positions() {
    let mut favorites = Favorites::default();
    for path in ["first.md", "second.md", "third.md", "fourth.md"] {
        favorites.add(Favorite {
            vault_id: None,
            path: PathBuf::from(path),
            kind: FavoriteKind::Document,
        });
    }
    let order = |favorites: &Favorites| {
        favorites
            .entries
            .iter()
            .map(|kept| kept.path.display().to_string())
            .collect::<Vec<_>>()
            .join(",")
    };

    // Dragged up: it lands in front of the row it was dropped on.
    assert!(favorites.move_before(Path::new("third.md"), Some(Path::new("first.md"))));
    assert_eq!(order(&favorites), "third.md,first.md,second.md,fourth.md");

    // Dragged down: taking it out first shifts the row it lands before up by one, and it must still end up in front of it.
    assert!(favorites.move_before(Path::new("third.md"), Some(Path::new("fourth.md"))));
    assert_eq!(order(&favorites), "first.md,second.md,third.md,fourth.md");

    // Dropped past the last row of the group: the end of the list.
    assert!(favorites.move_before(Path::new("first.md"), None));
    assert_eq!(order(&favorites), "second.md,third.md,fourth.md,first.md");

    // Either path being one the list does not hold changes nothing — the drawn list can still be showing a row that has left the store.
    assert!(!favorites.move_before(Path::new("gone.md"), Some(Path::new("second.md"))));
    assert!(!favorites.move_before(Path::new("second.md"), Some(Path::new("gone.md"))));
    // And a row dropped where it already is.
    assert!(!favorites.move_before(Path::new("third.md"), Some(Path::new("fourth.md"))));
    assert_eq!(order(&favorites), "second.md,third.md,fourth.md,first.md");
}

#[test]
fn settings_persistence_round_trips_and_falls_back_safely() {
    let dir = scratch_dir("settings-persistence");
    let settings_path = dir.join("config").join("settings.json");
    let missing_path = dir.join("missing.json");

    let settings = Settings {
        session: Session {
            tabs: vec![SessionTab {
                path: PathBuf::from("C:\\Users\\rwall\\Notes\\guide.md"),
                title: "Guide".to_string(),
                code_view: true,
                anchor: Some(ScrollAnchor {
                    section: Some("tasks".to_string()),
                    block: 2,
                    offset_y: -18.0,
                }),
                saved_code_scroll: Some(0.42),
                untitled: false,
                unsaved_text: Some("# Guide\n\nTyped and not saved.\n".to_string()),
                saved_text: Some("# Guide\n".to_string()),
            }],
            active: Some(0),
        },
        speed_reader_enabled: true,
        code_intel_enabled: false,
        reading_unlocked: true,
        code_unlocked: false,
        theme_family: "nightshade".to_string(),
        theme_mode: "dark".to_string(),
        theme_random_used: vec!["fern".to_string(), "github".to_string()],
        graph_scope: GraphScope::Large,
        library_project_path: "C:\\Users\\rwall".to_string(),
        library_closed: true,
        library_width: 312,
        window_width: 1440,
        window_height: 960,
        window_maximized: true,
        update_last_checked: 1_780_000_000,
        update_staged_version: "0.1.400".to_string(),
        update_auto_applied: String::new(),
        hint_launches: 3,
        hints_seen: vec!["libraryVault".to_string()],
        hint_last_launch: 2,
    };

    save_settings(&settings_path, &settings).expect("settings save");
    let loaded = load_settings(&settings_path);
    assert_eq!(loaded.settings, settings);
    // Read back cleanly, so there is nothing to tell the page about.
    assert!(!loaded.unreadable);
    fs::write(&settings_path, r#"{"library_width": 312}"#)
        .expect("pre-session settings fixture is written");
    let legacy = load_settings(&settings_path);
    assert_eq!(legacy.settings.session, Session::default());
    assert!(!legacy.unreadable);
    // A missing file restores defaults, not the all-false zero value — and is an ordinary first launch, not something to report.
    let missing = load_settings(&missing_path);
    assert_eq!(missing.settings, Settings::default());
    assert!(!missing.unreadable);

    fs::write(&settings_path, "{not json").expect("corrupt settings fixture is written");
    let corrupt = load_settings(&settings_path);
    assert_eq!(corrupt.settings, Settings::default());
    // A file that is there and does not parse is the one case worth a growl: the app is about to look factory-fresh with the file's contents ignored.
    assert!(corrupt.unreadable);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_byte_order_mark_from_a_windows_editor_does_not_reset_the_config() {
    let dir = scratch_dir("settings-bom");

    // PowerShell's Out-File/Set-Content and Notepad all write a UTF-8 byte order mark by default, so a hand-edited config on Windows arrives with three bytes in front of the opening brace. serde_json refuses them, and every reader here defaults on a parse failure — which silently threw the file away. Both config files must look past the mark.
    let settings_path = dir.join("settings.json");
    fs::write(
        &settings_path,
        "\u{feff}{\"library_width\": 312, \"code_intel_enabled\": false}",
    )
    .expect("BOM settings fixture is written");
    let loaded = load_settings(&settings_path);
    assert_eq!(loaded.settings.library_width, 312);
    assert!(!loaded.settings.code_intel_enabled);
    assert!(
        !loaded.unreadable,
        "a byte order mark must not count as an unreadable file"
    );

    let recent_path = dir.join("recent-files.json");
    fs::write(&recent_path, "\u{feff}{\"files\": [\"first.md\"]}")
        .expect("BOM recent files fixture is written");
    assert_eq!(
        load_recent_files(&recent_path).files,
        vec![PathBuf::from("first.md")]
    );

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn settings_load_migrates_legacy_dracula_mode_to_the_nightshade_family() {
    let dir = scratch_dir("settings-migrate");
    let settings_path = dir.join("settings.json");

    // Pre-family installs stored Dracula as a theme mode; it becomes the dark half of the Nightshade family (the renamed Dracula palette) on load.
    fs::write(&settings_path, r#"{"theme_mode": "dracula"}"#)
        .expect("legacy settings fixture is written");
    let loaded = load_settings(&settings_path).settings;
    assert_eq!(loaded.theme_family, "nightshade");
    assert_eq!(loaded.theme_mode, "dark");

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn settings_load_tolerates_partial_json_via_serde_default() {
    let dir = scratch_dir("settings-partial");
    let settings_path = dir.join("settings.json");

    // Only one field present: the rest must fall back to their defaults. Unknown keys — `indexing_enabled` from the old disk crawler, and the two toggles that stopped being choices — are ignored rather than failing the load, so an installed copy needs no migration to lose them.
    fs::write(
        &settings_path,
        r#"{"library_width": 312, "indexing_enabled": true, "minimap_enabled": false, "pager_enabled": false}"#,
    )
    .expect("partial settings fixture is written");
    let loaded = load_settings(&settings_path).settings;
    assert_eq!(loaded.library_width, 312);
    assert!(loaded.code_intel_enabled);
    assert_eq!(loaded.theme_mode, "daylight");
    assert!(!loaded.library_closed);
    // A file written before the first-run bubble existed reads as a first launch: no launches counted, no hint met, nothing shown yet. Anything else and an installed copy would either never see a hint or be told it had already met one.
    assert_eq!(loaded.hint_launches, 0);
    assert!(loaded.hints_seen.is_empty());
    assert_eq!(loaded.hint_last_launch, 0);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_settings_file_from_before_the_pane_had_one_view_still_loads() {
    let dir = scratch_dir("settings-library-view");

    // `library_view` was the pane's mode when the graph lived in the sidebar. The graph is a page now and the key is gone, but every installed copy still has it — and an unknown key must be ignored, not fail the whole deserialize and reset every other setting with it.
    for legacy in ["tree", "flat", "project", "graph"] {
        let settings_path = dir.join(format!("{legacy}.json"));
        fs::write(
            &settings_path,
            format!(r#"{{"library_view": "{legacy}", "code_intel_enabled": false}}"#),
        )
        .expect("legacy library view fixture is written");
        let loaded = load_settings(&settings_path).settings;
        assert!(!loaded.code_intel_enabled);
    }

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn an_unreadable_settings_file_reaches_the_page_as_a_growl() {
    // The whole point of the flag: coming up on defaults is invisible, so the page has to say it. Host side, it is always emitted so the flag is never undefined; page side, the boot growls only when it is true.
    assert_eq!(
        settings_unreadable_script(true),
        "window.__leafSettingsUnreadable = true;"
    );
    assert_eq!(
        settings_unreadable_script(false),
        "window.__leafSettingsUnreadable = false;"
    );

    let html = app_shell_page();
    assert_contains(&html, "if (window.__leafSettingsUnreadable) {");
    assert_contains(
        &html,
        "window.leafShowError('Your settings file could not be read",
    );
}

#[test]
fn settings_file_path_lives_in_leaftext_config() {
    let path = settings_file_path().expect("project config directory is available");
    assert!(path.ends_with("settings.json"));
    assert!(path.to_string_lossy().contains("leaftext"));
}

#[test]
fn webview_user_data_dir_uses_leaftext_local_data() {
    let path = webview_user_data_dir().expect("project data directory is available");
    let path_display = path.to_string_lossy();

    assert!(path.ends_with("webview2"));
    assert!(path_display.contains("leaftext"));
}

#[test]
fn app_data_dir_is_the_local_data_root_not_the_webview_cache() {
    let path = app_data_dir().expect("project data directory is available");
    let path_display = path.to_string_lossy();
    assert!(path_display.contains("leaftext"));
    // The manifest must not live under the WebView2-specific subfolder.
    assert!(!path.ends_with("webview2"));
}

/// These paths are where every installed copy already keeps its settings, recent files, and vault registry, so they are a compatibility contract, not a preference. They were captured from the `directories` crate's `ProjectDirs::from("com", "ryanallen", "leaftext")` before that dependency was replaced with the plain environment lookups in `installed_config_dir` and `installed_data_local_dir`. Changing either shape silently orphans user data: the app would start up looking clean, with the old settings still on disk.
#[test]
fn project_dirs_match_the_documented_layout() {
    let config = installed_config_dir().expect("config directory is available");
    let data = installed_data_local_dir().expect("data directory is available");

    #[cfg(windows)]
    {
        let roaming = PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA is set"));
        let local = PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA is set"));
        assert_eq!(
            config,
            roaming.join("ryanallen").join("leaftext").join("config")
        );
        assert_eq!(data, local.join("ryanallen").join("leaftext").join("data"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = PathBuf::from(std::env::var_os("HOME").expect("HOME is set"));
        let support = home
            .join("Library/Application Support")
            .join("com.ryanallen.leaftext");
        // macOS draws no roaming/local distinction, so both roots are the one Application Support folder.
        assert_eq!(config, support);
        assert_eq!(data, support);
    }
}

/// A remote vault's files are copied to a folder the app owns, and the vault row points at it — so this path is a contract with every installed copy exactly as the two roots above it are. Moving it strands a mirror somewhere nothing will ever look, with no vault to explain it and nothing to clean it up.
#[test]
fn a_vault_mirror_sits_under_the_data_root_keyed_on_the_row_id() {
    let data = project_data_local_dir().expect("data directory is available");
    let mirror = vault_mirror_dir(&data, 42);

    assert_eq!(mirror, data.join("remote").join("42"));
    // Keyed on the id and never the name: a vault may be renamed, and two may be called the same thing.
    assert_ne!(mirror, vault_mirror_dir(&data, 43));
    // Under the app's own data root rather than beside somebody's documents, which is what makes removing it the app's business.
    assert!(mirror.starts_with(&data));
}

#[test]
fn document_format_follows_extension() {
    assert_eq!(
        DocumentFormat::from_path(Path::new("notes.md")),
        DocumentFormat::Markdown
    );
    assert_eq!(
        DocumentFormat::from_path(Path::new("book.XML")),
        DocumentFormat::Xml
    );
    assert_eq!(
        DocumentFormat::from_path(Path::new("package.json")),
        DocumentFormat::Json
    );
    for name in ["release.yaml", "release.YML"] {
        assert_eq!(
            DocumentFormat::from_path(Path::new(name)),
            DocumentFormat::Yaml,
            "{name}"
        );
    }
    // Unknown / missing extensions route through the Markdown renderer, matching how the loader treats everything it does not recognize.
    assert_eq!(
        DocumentFormat::from_path(Path::new("README")),
        DocumentFormat::Markdown
    );
}

/// `for_path` is the "can we open this at all?" question, so unlike `from_path` it must not quietly answer Markdown for a format the app cannot read.
#[test]
fn unreadable_extensions_have_no_format() {
    for name in [
        "photo.png",
        "book.epub",
        "archive.zip",
        "notes.rtf",
        "README",
    ] {
        assert_eq!(
            DocumentFormat::for_path(Path::new(name)),
            None,
            "{name} is not a format the app reads"
        );
        assert!(!is_supported_document_path(Path::new(name)), "{name}");
    }
}

/// Every extension the table lists must round-trip back to its own format, and the flat list the file dialog offers must be exactly those extensions. This is the test that keeps a new format from being half-added.
#[test]
fn every_listed_extension_maps_back_to_its_format() {
    let mut listed = Vec::new();
    for format in DocumentFormat::ALL
        .into_iter()
        .filter(|format| *format != DocumentFormat::Code)
    {
        assert!(
            !format.extensions().is_empty(),
            "{format:?} must name at least one extension"
        );
        for extension in format.extensions() {
            assert_eq!(
                &extension.to_ascii_lowercase(),
                extension,
                "{extension} must be listed lowercase"
            );
            assert_eq!(
                DocumentFormat::from_extension(extension),
                Some(format),
                ".{extension} should read as {format:?}"
            );
            // Case-insensitively too: extensions arrive as the user typed them.
            assert_eq!(
                DocumentFormat::from_extension(&extension.to_ascii_uppercase()),
                Some(format),
                ".{extension} uppercase should read as {format:?}"
            );
            assert!(
                !listed.contains(extension),
                ".{extension} is claimed by two formats"
            );
            listed.push(extension);
        }
    }
    for extension in source_extensions() {
        assert_eq!(
            DocumentFormat::from_extension(extension),
            Some(DocumentFormat::Code)
        );
        assert!(!listed.contains(&extension), ".{extension} is listed twice");
        listed.push(extension);
    }
    assert_eq!(all_document_extensions(), listed);
}

/// The installers are the three places the extension list lives outside `format.rs`, and none of them can read it at install time: the MSI claims each extension in the registry, the EXE installer claims them from its own table, and the macOS bundle claims them in its Info.plist. This is what keeps a format the app opens from shipping without its double-click — .json, .yaml, .yml, .eml, .mht and .mhtml all did.
///
/// Windows has two installers because one of them is refused by policy on some machines, so the Windows half of this is asserted twice — differently, because the two are written differently. The MSI names every key it writes, so it is searched for them. The EXE installer builds its keys from one list, so that list is read out and compared whole: an extension it never mentions is exactly what a missing entry looks like there.
#[test]
fn installer_claims_every_readable_extension() {
    let wxs = include_str!("../../wix/main.wxs");
    let plist = include_str!("../../.github/workflows/release-distributions.yml");

    for extension in all_document_extensions() {
        // The closing quote matters: .mht must not pass on .mhtml's entry.
        for needle in [
            format!(r"Key='Software\Classes\.{extension}\OpenWithProgids'"),
            format!(r"SupportedTypes' Name='.{extension}'"),
            format!(r"Capabilities\FileAssociations' Name='.{extension}'"),
        ] {
            assert!(
                wxs.contains(&needle),
                "wix/main.wxs does not claim .{extension}: missing {needle}"
            );
        }
        assert!(
            plist.contains(&format!("<string>{extension}</string>")),
            "the macOS Info.plist in release-distributions.yml does not claim .{extension}"
        );
    }

    assert_eq!(
        exe_installer_extensions(),
        all_document_extensions(),
        "installer/src/plan.rs claims a different set of extensions from format.rs"
    );

    // The bare extension key is what takes a file type off whatever opens it today, so the formats Leaftext is only offered for must not carry one: HTML stays with the browser, and plain text with Notepad. The six packaged formats are offered the same way and have a test of their own, because what each of them keeps is a whole application rather than a system default.
    for extension in ["html", "htm", "txt", "ini"] {
        assert!(
            !wxs.contains(&format!(r"Key='Software\Classes\.{extension}' Type=")),
            "the MSI takes .{extension} away from whatever opens it today"
        );
    }

    for extension in ["html", "htm"] {
        let entry = macos_document_type_entries()
            .into_iter()
            .find(|entry| {
                plist_strings(entry, "CFBundleTypeExtensions")
                    .iter()
                    .any(|item| item == extension)
            })
            .expect("macOS offers HTML files");
        assert_eq!(
            plist_string(&entry, "LSHandlerRank").as_deref(),
            Some("Alternate")
        );
        assert_eq!(plist_strings(&entry, "LSItemContentTypes"), ["public.html"]);
    }
}

/// The six packaged formats are offered and never taken. Word owns `.docx` on a machine that has Word, Excel owns `.xlsx` and PowerPoint owns `.pptx`, and taking a file type away from the application that owns it is the class of thing that has cost this app version numbers — so all three registry shapes claim them, the bare class key never names one, and neither installer makes Leaftext their default.
#[test]
fn the_installers_offer_the_packaged_formats_and_own_none_of_them() {
    let wxs = include_str!("../../wix/main.wxs");
    let entries = macos_document_type_entries();

    for extension in ["docx", "xlsx", "pptx", "odt", "ods", "odp"] {
        assert!(
            !wxs.contains(&format!(r"Key='Software\Classes\.{extension}' Type=")),
            "the MSI takes .{extension} away from the application that owns it"
        );
        assert!(
            plan_owned_extensions()
                .iter()
                .all(|owned| *owned != extension),
            "installer/src/plan.rs makes Leaftext the default handler for .{extension}"
        );
        let entry = entries
            .iter()
            .find(|entry| {
                plist_strings(entry, "CFBundleTypeExtensions")
                    .iter()
                    .any(|item| item == extension)
            })
            .unwrap_or_else(|| panic!("macOS offers .{extension} files"));
        assert_eq!(
            plist_string(entry, "LSHandlerRank").as_deref(),
            Some("Alternate"),
            "Default rank here would take .{extension} from the app that owns it on every Mac that installs an update"
        );
        assert_eq!(
            plist_string(entry, "CFBundleTypeIconFile").as_deref(),
            Some("Leaf"),
            "an entry claiming .{extension} and naming no icon leaves Finder a blank page"
        );
        assert!(
            plist_strings(entry, "LSItemContentTypes").is_empty(),
            "naming a content type for .{extension} makes Launch Services ignore the extension beside it"
        );
    }
}

/// WiX derives a component's GUID from the registry key it writes, so two rows writing one key are one key added twice and `light` stops the build with `Item has already been added` — which is a failure only the release sees, because WiX cannot run on this machine. Two tickets adding `.ini` on the same afternoon is exactly how it happens, and v1.51.0's Windows build died on it.
#[test]
fn the_msi_writes_each_registry_key_once() {
    let wxs = include_str!("../../wix/main.wxs");
    let mut seen: Vec<(String, String, String)> = Vec::new();

    // One `<RegistryValue .../>` a line, which is how the file is written; a row split over lines would read as no row at all rather than as a false pass, because the three fields are read off the same line.
    for line in wxs.lines().filter(|line| line.contains("<RegistryValue")) {
        let field = |name: &str| {
            line.split_once(&format!("{name}='"))
                .and_then(|(_, rest)| rest.split_once('\''))
                .map(|(value, _)| value.to_string())
                .unwrap_or_default()
        };
        let row = (field("Root"), field("Key"), field("Name"));
        if row.1.is_empty() {
            continue;
        }
        assert!(
            !seen.contains(&row),
            "wix/main.wxs writes {}\\{} ({}) twice, which WiX refuses as one component added twice",
            row.0,
            row.1,
            row.2
        );
        seen.push(row);
    }

    assert!(
        seen.len() > 100,
        "only {} registry rows were read, so the reader stopped matching the file",
        seen.len()
    );
}

#[test]
fn source_extensions_are_offered_without_becoming_the_windows_default() {
    let wxs = include_str!("../../wix/main.wxs");
    let source_entry = macos_document_type_entries()
        .into_iter()
        .find(|entry| {
            plist_string(entry, "CFBundleTypeName").as_deref() == Some("Source Code Document")
        })
        .expect("macOS offers source files");
    assert_eq!(
        plist_string(&source_entry, "LSHandlerRank").as_deref(),
        Some("Alternate")
    );
    for extension in source_extensions() {
        assert!(
            !wxs.contains(&format!(r"Key='Software\Classes\.{extension}' Type=")),
            ".{extension} becomes a Windows default"
        );
        assert!(plist_strings(&source_entry, "CFBundleTypeExtensions")
            .iter()
            .any(|item| item == extension));
    }
}

/// `.txt` is offered and never imposed. Notepad and TextEdit own plain text on the machines Leaftext installs onto, so the claim has to be the smaller one everywhere: no bare extension key in either Windows installer, and on macOS an entry claiming the one spelling with no content type beside it. A content type would attach the leaf to `public.plain-text`, which is every `.log` and `.csv` on the machine — a far bigger claim than opening one file — which is why the existing plain-text entry is left claiming no extensions at all.
#[test]
fn plain_text_is_offered_by_its_one_spelling_and_never_imposed() {
    let wxs = include_str!("../../wix/main.wxs");
    let entries = macos_document_type_entries();

    // Offered in all three Windows shapes.
    for needle in [
        r"Key='Software\Classes\.txt\OpenWithProgids'",
        r"SupportedTypes' Name='.txt'",
        r"Capabilities\FileAssociations' Name='.txt'",
    ] {
        assert!(
            wxs.contains(needle),
            "the MSI does not offer .txt: {needle}"
        );
    }
    // And never taken.
    assert!(
        !wxs.contains(r"Key='Software\Classes\.txt' Type="),
        "the MSI takes .txt away from whatever opens it today"
    );
    assert!(
        plan_owned_extensions().iter().all(|owned| *owned != "txt"),
        "installer/src/plan.rs makes Leaftext the default handler for .txt"
    );

    let entry = entries
        .iter()
        .find(|entry| plist_string(entry, "CFBundleTypeName").as_deref() == Some("Text Document"))
        .expect("macOS offers plain text files");
    assert_eq!(plist_strings(entry, "CFBundleTypeExtensions"), ["txt"]);
    assert_eq!(
        plist_string(entry, "LSHandlerRank").as_deref(),
        Some("Alternate"),
        "Default rank here would take .txt from TextEdit on every Mac that installs an update"
    );
    assert_eq!(
        plist_string(entry, "CFBundleTypeRole").as_deref(),
        Some("Viewer")
    );
    assert_eq!(
        plist_string(entry, "CFBundleTypeIconFile").as_deref(),
        Some("Leaf"),
        "an entry claiming an extension and naming no icon leaves Finder a blank page"
    );
    assert!(
        !entry.contains("<key>LSItemContentTypes</key>"),
        "a content type here puts the leaf on public.plain-text, which is every .log and .csv on the machine"
    );

    // The entry that does name that content type is left exactly as it was: no extensions, so it claims no file.
    let plain = entries
        .iter()
        .find(|entry| {
            plist_string(entry, "CFBundleTypeName").as_deref() == Some("Plain Text Document")
        })
        .expect("the plain text entry is still there");
    assert!(plist_strings(plain, "CFBundleTypeExtensions").is_empty());
    assert_eq!(
        plist_strings(plain, "LSItemContentTypes"),
        ["public.plain-text"]
    );
    assert_eq!(
        plist_string(plain, "LSHandlerRank").as_deref(),
        Some("Alternate")
    );
}

/// `.ini` is claimed the same way `.txt` is, and for the same reason: whatever opens a machine's config files today keeps them. On macOS the entry names no content type, because a config file has none to name and naming one would make Launch Services ignore the extension beside it.
#[test]
fn an_ini_file_is_offered_by_its_one_spelling_and_never_imposed() {
    let wxs = include_str!("../../wix/main.wxs");

    for needle in [
        r"Key='Software\Classes\.ini\OpenWithProgids'",
        r"SupportedTypes' Name='.ini'",
        r"Capabilities\FileAssociations' Name='.ini'",
    ] {
        assert!(
            wxs.contains(needle),
            "the MSI does not offer .ini: {needle}"
        );
    }
    assert!(
        !wxs.contains(r"Key='Software\Classes\.ini' Type="),
        "the MSI takes .ini away from whatever opens it today"
    );
    assert!(
        plan_owned_extensions().iter().all(|owned| *owned != "ini"),
        "installer/src/plan.rs makes Leaftext the default handler for .ini"
    );

    let entries = macos_document_type_entries();
    let entry = entries
        .iter()
        .find(|entry| plist_string(entry, "CFBundleTypeName").as_deref() == Some("INI Document"))
        .expect("macOS offers INI files");
    assert_eq!(plist_strings(entry, "CFBundleTypeExtensions"), ["ini"]);
    assert_eq!(
        plist_string(entry, "LSHandlerRank").as_deref(),
        Some("Alternate")
    );
    assert_eq!(
        plist_string(entry, "CFBundleTypeIconFile").as_deref(),
        Some("Leaf")
    );
    assert!(!entry.contains("<key>LSItemContentTypes</key>"));

    // And exactly one entry claims it: a config file read as a page of sections is not the source-code entry's.
    let claiming = entries
        .iter()
        .filter(|entry| {
            plist_strings(entry, "CFBundleTypeExtensions")
                .iter()
                .any(|item| item == "ini")
        })
        .count();
    assert_eq!(claiming, 1, "two macOS entries claim .ini");
}

/// The installation page's list of registered extensions is a promise to somebody deciding whether to install, and it is written by hand — so it goes stale the moment a format lands and nobody thinks of it. Every ending a named format reads has to appear there. The source-file endings are the one exception, and deliberately: that page names them as a class rather than listing thirty of them, and [the rendering page](../../docs/01-features/01-rendering.md#source-files) lists the languages.
#[test]
fn the_installation_page_names_every_extension_the_app_registers() {
    let page = include_str!("../../docs/02-installation.md");
    for format in DocumentFormat::ALL {
        if format == DocumentFormat::Code {
            continue;
        }
        for extension in format.extensions() {
            assert!(
                page.contains(&format!("`.{extension}`")),
                "docs/02-installation.md does not name .{extension}, which the installers register"
            );
        }
    }
}

/// A Cursor project rule is a Markdown document with a frontmatter block, spelled `.mdc`. It reads as Markdown through every door an extension is asked at — the Windows Open window, the folder pane, links, the pager and the installers — which is the whole of what admitting it means. The one place it is not offered is a save window: `MARKDOWN_EXPORT_EXTENSIONS` is a shorter list, and `src/app/tests/export.rs` holds that end.
#[test]
fn a_cursor_rule_reads_as_markdown_wherever_an_extension_is_asked_about() {
    // Both spellings, because an extension arrives from the filesystem as somebody typed it.
    for name in [".cursor/rules/style.mdc", ".cursor/rules/STYLE.MDC"] {
        assert_eq!(
            DocumentFormat::for_path(Path::new(name)),
            Some(DocumentFormat::Markdown),
            "{name} is a Cursor rule and the app must open it as Markdown"
        );
        assert!(
            is_supported_document_path(Path::new(name)),
            "{name} is refused by the one answer every door asks"
        );
    }

    // The Windows Open window's combined row is this flat list, so a spelling missing here cannot be picked in the dialog at all.
    assert!(
        all_document_extensions().contains(&"mdc"),
        "the Open window's Documents row does not offer a Cursor rule"
    );

    // A rule sits in a folder of rules, so Prev/Next has to walk to the one beside it.
    assert!(is_pager_page_extension("mdc"));
    assert!(is_pager_page_extension("MDC"));
    assert_eq!(pager_label("code-style.mdc"), "Code Style");

    // Double-clicking one has to reach the app, which is three separate claims in three files that cannot read `format.rs` at install time.
    let wxs = include_str!("../../wix/main.wxs");
    for needle in [
        r"Key='Software\Classes\.mdc'",
        r"SupportedTypes' Name='.mdc'",
        r"Capabilities\FileAssociations' Name='.mdc'",
    ] {
        assert!(
            wxs.contains(needle),
            "wix/main.wxs does not claim .mdc: missing {needle}"
        );
    }
    assert!(
        exe_installer_extensions().contains(&"mdc"),
        "installer/src/plan.rs does not claim .mdc"
    );
    // Read as structure, because on a Mac the spelling being somewhere in the file is not the claim: an extension list beside a content type is ignored. Which entry it must be, and what that entry must say, is `a_cursor_rule_is_claimed_by_extension_rather_than_by_a_type_that_omits_it`.
    assert!(
        macos_document_type_entries().iter().any(|entry| {
            !entry.contains("<key>LSItemContentTypes</key>")
                && plist_strings(entry, "CFBundleTypeExtensions")
                    .iter()
                    .any(|extension| extension == "mdc")
        }),
        "no macOS document entry claims .mdc where Launch Services reads it"
    );
}

/// An install somebody ran themselves ends with Leaftext open; an install the updater ran ends with nothing, because the updater reopens the app itself and a scripted or managed install must start no program at all. In the MSI that whole rule is one condition on one action, so the condition is what this reads — with the recipe's comments stripped first, so a sentence explaining the rule cannot stand in for the rule.
#[test]
fn the_msi_opens_the_app_only_for_somebody_who_ran_the_install() {
    let source = wix_source_without_comments();
    let action = msi_launch_action(&source);
    assert!(
        action.contains("FileKey='MainExecutableFile'"),
        "the MSI must open the app it installed, not a path spelled again: {action}"
    );
    assert!(
        action.contains("Return='asyncNoWait'"),
        "msiexec must not wait on the app it opened: {action}"
    );

    let (attributes, condition) = msi_launch_row(&source);
    assert!(
        attributes.contains("After='InstallFinalize'"),
        "the app opens once the install is finished: {attributes}"
    );
    assert!(
        condition.contains("UILevel=5"),
        "a silent install must open nothing — the updater passes /qn, which is UILevel=2, and relaunches the app itself: {condition}"
    );
    assert!(
        condition.contains("NOT Installed"),
        "a repair, a modify and an uninstall must open nothing: {condition}"
    );
}

/// The two Windows installers produce one install, so they owe one first experience too — and each writes its half of it in its own language, which is why neither can read the other's. Both are read here: the EXE installer's rule that a silent run opens nothing, the MSI's condition saying the same, and the one path underneath both of them.
#[test]
fn both_windows_installers_open_the_app_they_installed_and_only_for_a_person() {
    // Held as source because the installer is a binary crate with no library target, so nothing here can `use` it.
    let launch = include_str!("../../installer/src/launch.rs");
    assert!(
        launch.contains("if request.silent") && launch.contains("return None;"),
        "the EXE installer must open nothing on a silent run"
    );

    let source = wix_source_without_comments();
    let (_, condition) = msi_launch_row(&source);
    assert!(condition.contains("UILevel=5"), "and neither may the MSI");

    // The one path they both open. The EXE installer joins this onto the chosen folder and the MSI builds it out of a directory and a file, so the two spellings are held together here.
    let (folder, file) = exe_installer_app_path()
        .split_once('\\')
        .expect("the app sits in a folder under the install folder");
    assert!(
        source.contains(&format!("<Directory Id='Bin' Name='{folder}'>")),
        "wix/main.wxs puts the app somewhere other than {folder}"
    );
    let executable = source
        .split("<File")
        .find(|row| row.contains("Id='MainExecutableFile'"))
        .expect("the MSI must carry the app");
    assert!(
        executable.contains(&format!("Name='{file}'")),
        "wix/main.wxs names the app something other than {file}"
    );
}

/// `wix/main.wxs` with its comments removed, so a rule is asserted against what WiX compiles rather than against a comment describing it.
fn wix_source_without_comments() -> String {
    let mut source = String::new();
    let mut rest = include_str!("../../wix/main.wxs");
    while let Some((before, after)) = rest.split_once("<!--") {
        source.push_str(before);
        rest = after.split_once("-->").expect("every comment must close").1;
    }
    source.push_str(rest);
    source
}

/// The one action that opens the app, out of the MSI recipe.
fn msi_launch_action(source: &str) -> &str {
    source
        .split("<CustomAction")
        .find(|row| row.contains("Id='LaunchLeaftext'"))
        .expect("the MSI must carry an action that opens the app")
        .split_once("/>")
        .expect("the action must close")
        .0
}

/// Where that action is scheduled, split into what it is and when it fires. The condition is the whole of the silent-run rule.
fn msi_launch_row(source: &str) -> (&str, &str) {
    let sequence = source
        .split_once("<InstallExecuteSequence>")
        .expect("the MSI must sequence the launch")
        .1
        .split_once("</InstallExecuteSequence>")
        .expect("the sequence must close")
        .0;
    let row = sequence
        .split("<Custom ")
        .find(|row| row.contains("Action='LaunchLeaftext'"))
        .expect("the launch must be sequenced");
    let (attributes, rest) = row.split_once('>').expect("the row must open");
    let condition = rest.split_once("</Custom>").expect("the row must close").0;
    (attributes, condition)
}

/// The app's path under the install folder, out of the EXE installer's plan. It is one constant there, so reading it is what stops the MSI's own spelling drifting away from it.
fn exe_installer_app_path() -> &'static str {
    // Held as source because the installer is a binary crate with no library target; the value is taken rather than the line asserted.
    include_str!("../../installer/src/plan.rs")
        .split_once("pub const APP_RELATIVE_PATH: &str = r\"")
        .expect("installer/src/plan.rs must name the app once")
        .1
        .split_once('"')
        .expect("the path must close")
        .0
}

/// The `EXTENSIONS` list out of the EXE installer's plan. Read rather than searched: that installer builds every registry key it writes from this one list, so the list is the claim.
fn exe_installer_extensions() -> Vec<&'static str> {
    // Held as source for the same reason, and taken as a value the same way.
    let plan = include_str!("../../installer/src/plan.rs");
    let table = plan
        .split_once("pub const EXTENSIONS: &[&str] = &[")
        .expect("installer/src/plan.rs must hold one table of extensions")
        .1
        .split_once("];")
        .expect("the extension table must close")
        .0;
    table
        .split(',')
        .map(|entry| entry.trim().trim_matches('"'))
        .filter(|entry| !entry.is_empty())
        .collect()
}

/// The `OWNED_EXTENSIONS` list out of the EXE installer's plan — the shorter list, the one that takes a file type off whatever opens it today. Read the same way `exe_installer_extensions` reads the longer one.
fn plan_owned_extensions() -> Vec<&'static str> {
    let plan = include_str!("../../installer/src/plan.rs");
    let table = plan
        .split_once("pub const OWNED_EXTENSIONS: &[&str] = &[")
        .expect("installer/src/plan.rs must hold one table of owned extensions")
        .1
        .split_once("];")
        .expect("the owned extension table must close")
        .0;
    table
        .split(',')
        .map(|entry| entry.trim().trim_matches('"'))
        .filter(|entry| !entry.is_empty())
        .collect()
}

/// The `CFBundleDocumentTypes` entries out of the Info.plist the macOS workflow writes, one string per entry. Read as structure rather than searched as text: an extension in a comment is not a claim, and a key in one entry says nothing about the next.
fn macos_document_type_entries() -> Vec<String> {
    let workflow = include_str!("../../.github/workflows/release-distributions.yml");
    let block = workflow
        .split_once("<key>CFBundleDocumentTypes</key>")
        .expect("the macOS bundle must claim document types")
        .1;
    let block = block
        .split_once("</plist>")
        .expect("the Info.plist heredoc must close")
        .0;

    let mut entries = Vec::new();
    let mut rest = block;
    while let Some((_, after_open)) = rest.split_once("<dict>") {
        let (entry, after_close) = after_open
            .split_once("</dict>")
            .expect("every document type entry must close");
        entries.push(entry.to_string());
        rest = after_close;
    }
    entries
}

/// The value of a plist `<string>` key inside one entry.
fn plist_string(entry: &str, key: &str) -> Option<String> {
    let after_key = entry.split_once(&format!("<key>{key}</key>"))?.1;
    let value = after_key
        .split_once("<string>")?
        .1
        .split_once("</string>")?
        .0;
    Some(value.trim().to_string())
}

/// The values of a plist `<array>` of strings under a named key inside one entry. Empty where the key is absent, which is itself an answer: an entry claiming no extensions claims no spelling.
fn plist_strings(entry: &str, key: &str) -> Vec<String> {
    let Some((_, after_key)) = entry.split_once(&format!("<key>{key}</key>")) else {
        return Vec::new();
    };
    let Some((array, _)) = after_key.split_once("</array>") else {
        return Vec::new();
    };

    let mut values = Vec::new();
    let mut rest = array;
    while let Some((_, after_open)) = rest.split_once("<string>") {
        let Some((value, after_close)) = after_open.split_once("</string>") else {
            break;
        };
        values.push(value.trim().to_string());
        rest = after_close;
    }
    values
}

/// Cursor's `.mdc` cannot ride in the Markdown entry. Launch Services ignores an entry's extension list whenever that entry also names a content type, and the Markdown type covers `.md` and `.markdown` — never Cursor's spelling — so an `.mdc` written there is claimed by nothing at all and a rule sits in the Finder as a blank page with leaftext absent from Open With. It gets an entry of its own naming extensions and no type, the shape the email entry already uses for a spelling with no type to import. Read as structure rather than searched: an extension sitting in the file where nothing reads it is exactly this fault, so a text search passes on the broken shape.
#[test]
fn a_cursor_rule_is_claimed_by_extension_rather_than_by_a_type_that_omits_it() {
    let entries = macos_document_type_entries();
    let claiming: Vec<&String> = entries
        .iter()
        .filter(|entry| {
            plist_strings(entry, "CFBundleTypeExtensions")
                .iter()
                .any(|e| e == "mdc")
        })
        .collect();
    assert_eq!(
        claiming.len(),
        1,
        "exactly one macOS document entry claims .mdc, and it is the one Launch Services reads"
    );

    let entry = claiming[0];
    assert_eq!(
        plist_string(entry, "CFBundleTypeName").as_deref(),
        Some("Cursor Rule")
    );
    assert_eq!(
        plist_strings(entry, "CFBundleTypeExtensions"),
        ["mdc"],
        "the Cursor Rule entry claims that one spelling; the rest keep their own entries"
    );
    assert!(
        !entry.contains("<key>LSItemContentTypes</key>"),
        "a content type here would make Launch Services ignore the extension beside it, which is the fault"
    );
    assert_eq!(
        plist_string(entry, "CFBundleTypeIconFile").as_deref(),
        Some("Leaf"),
        "without the icon Finder draws a blank page for a rule whoever the default handler is"
    );
    assert_eq!(
        plist_string(entry, "CFBundleTypeRole").as_deref(),
        Some("Viewer"),
        "macOS reserves Editor for apps that own saving the format"
    );
    assert_eq!(
        plist_string(entry, "LSHandlerRank").as_deref(),
        Some("Default"),
        "Default is what hands leaftext an unclaimed spelling without taking one somebody chose"
    );

    // The Markdown entry keeps the spellings its type does cover, and must not take this one back.
    let markdown = entries
        .iter()
        .find(|entry| {
            plist_string(entry, "CFBundleTypeName").as_deref() == Some("Markdown Document")
        })
        .expect("the bundle must claim Markdown");
    assert!(
        !plist_strings(markdown, "CFBundleTypeExtensions")
            .iter()
            .any(|e| e == "mdc"),
        "the Markdown entry names a content type, so an .mdc written there is read by nothing"
    );
}

/// An entry that claims a file type and names no icon leaves Finder nothing to draw for that type, whoever the default handler is — which is why every `.md` file on a Mac was a blank page while the app itself wore the leaf. The plain text entry is the one that claims no extensions, on purpose, so an icon there would mark files the app never claimed.
#[test]
fn every_macos_file_type_claiming_extensions_names_the_icon() {
    let workflow = include_str!("../../.github/workflows/release-distributions.yml");
    let entries = macos_document_type_entries();
    assert_eq!(entries.len(), 15, "the bundle claims fifteen file types");

    for entry in &entries {
        let name = plist_string(entry, "CFBundleTypeName").expect("every entry names its type");
        if !entry.contains("<key>CFBundleTypeExtensions</key>") {
            assert_eq!(
                name, "Plain Text Document",
                "{name} claims no extensions; only plain text is allowed to"
            );
            assert!(
                plist_string(entry, "CFBundleTypeIconFile").is_none(),
                "{name} claims no extensions, so the leaf would mark files the app never claimed"
            );
            continue;
        }
        assert_eq!(
            plist_string(entry, "CFBundleTypeIconFile").as_deref(),
            Some("Leaf"),
            "{name} claims extensions and must name the Leaf icon, or Finder draws a blank page"
        );
    }

    // The name every entry gives is a resource in the bundle, built by the packaging step below the plist.
    assert!(
        workflow.contains(r#"${app_resources}/Leaf.icns"#),
        "the packaging step must write the Leaf.icns the entries name"
    );
}

/// The sentence macOS shows when it asks whether the app may read a folder is written in the bundle, and it is the only thing the reader is given at the moment they decide. Dropping a key leaves macOS its own wording or an outright refusal, and the background indexer these once described was removed in migration 6 — so the word must not come back, in a string or in a comment beside one.
#[test]
fn macos_folder_asks_say_what_the_app_does() {
    let workflow = include_str!("../../.github/workflows/release-distributions.yml");
    for key in [
        "NSDesktopFolderUsageDescription",
        "NSDocumentsFolderUsageDescription",
        "NSDownloadsFolderUsageDescription",
        "NSRemovableVolumesUsageDescription",
        "NSNetworkVolumesUsageDescription",
    ] {
        let reason = plist_string(workflow, key).unwrap_or_else(|| {
            panic!("{key} must be in the bundle, or macOS writes the ask itself")
        });
        assert!(
            !reason.is_empty(),
            "{key} is empty, so the reader is asked for a folder with no reason"
        );
    }

    assert!(
        !workflow.to_ascii_lowercase().contains("index"),
        "nothing walks a folder the user did not point at; an ask describing an index describes the behavior they would most reasonably refuse"
    );
}

/// Opening and listing are separate format-table answers: a source path opens when named without becoming a page beside a note.
#[test]
fn direct_open_and_listed_document_gates_keep_source_files_out_of_the_pager() {
    for extension in all_document_extensions()
        .into_iter()
        .filter(|extension| !source_extensions().contains(extension))
    {
        assert!(
            is_pager_page_extension(extension),
            ".{extension} opens but Prev/Next skips it"
        );
        assert!(
            is_pager_page_extension(&extension.to_ascii_uppercase()),
            ".{extension} uppercase should page too"
        );
    }
    for extension in source_extensions() {
        assert!(is_supported_document_path(Path::new(&format!(
            "file.{extension}"
        ))));
        assert!(!is_pager_page_extension(extension));
    }
    // `.markdown` and `.mdown` open like any other page, so they must also page and lose their extension in the label.
    assert!(is_pager_page_extension("markdown"));
    assert!(is_pager_page_extension("mdown"));
    assert_eq!(pager_label("getting-started.markdown"), "Getting Started");
    assert!(!is_pager_page_extension("png"));
}

#[test]
fn updating_is_not_a_setting() {
    // Updating is what the app does, not an opt-in: no toggle, no string for one.
    let html = app_shell_page();
    assert!(!html.contains("autoUpdateEnabled"));
    assert!(!html.contains("settings.autoUpdate"));
    assert!(!html.contains("setAutoUpdateEnabled"));
    assert!(!html.contains("update.downloadsOff"));

    // The two states worth a word, and nothing else.
    for wording in [
        "`Downloading v${version}… ${percent}%`",
        "'Restart to update'",
    ] {
        assert_contains(&html, wording);
    }
}

#[test]
fn the_updater_only_speaks_when_it_can_install() {
    // A check that found nothing, could not reach GitHub, or found a release with no installer for this platform is the app's own business — there is nothing for the reader to do about any of it. Reporting it made the panel look like it was asking for work it should be doing itself.
    let html = app_shell_page();
    for gone in [
        "Check for updates",
        "Up to date",
        "Last checked",
        "Checked just now",
        "Could not reach GitHub",
        "Update failed",
        "publishes no installer",
        "`Update to v${version}`",
        "settingsCheck",
    ] {
        assert!(!html.contains(gone), "the updater still says {gone:?}");
    }

    // What is left: the download's spinner and progress fill, and the dot the bell raises with its panel shut.
    assert!(html.contains(r#"id="updateButtonSpinner""#));
    assert!(html.contains(r#"id="updateButtonFill""#));
    let css = reading_mode_css();
    assert!(css.contains(".update-button-spinner"));
    assert!(css.contains(".update-alert-dot.is-downloading"));
    assert!(!css.contains(".settings-check"));
}

#[test]
fn the_update_bell_is_out_of_the_bar_until_there_is_news() {
    // Not a control that sits there saying nothing: the bell is in the app bar only while an installer is downloading or waiting, so its presence is the message. An action appearing mid-session changes what fits beside the tabs, which is why un-hiding it refits the bar.
    let html = app_shell_page();
    assert!(html.contains(r#"<details class="update-menu" id="updateMenu" hidden>"#));
    for expected in [
        "const news = downloading || status === 'staged';",
        "updateMenu.hidden = !news;",
        "if (!news) updateMenu.open = false;",
        "if (wasHidden !== updateMenu.hidden) refitAppBar();",
    ] {
        assert_contains(&html, expected);
    }
    // Escape and the outside click go through the shared helper, not a second hand-rolled pair.
    assert_contains(
        &html,
        "if (updateMenu.open && !updateMenu.contains(event.target)) updateMenu.open = false;",
    );
    // The settings menu and everything that hung off it are gone.
    for gone in [
        "settings-menu",
        "settingsMenu",
        "settingsSummary",
        "settings-panel",
        "settingsAlertDot",
        "settingsVersion",
        "setting-theme-open",
        "pagerEnabled",
        "minimapEnabledControl",
    ] {
        assert!(!html.contains(gone), "the settings menu is back: {gone}");
    }
    let css = reading_mode_css();
    for gone in [".settings-", ".setting-", "data-pager-enabled"] {
        assert!(!css.contains(gone), "the stylesheet still paints {gone}");
    }
}

#[test]
fn the_home_screen_shows_the_running_version() {
    let html = app_shell_page();
    // In the template string, not read out of the DOM once at load: the home screen is rebuilt on every render, so a cached element would go stale after the first showing.
    assert!(html.contains(
        r#"<p class="empty-version">${LEAF_VERSION ? `v${escapeText(LEAF_VERSION)}` : ''}</p>"#
    ));
    // The number itself comes from the init script, not the markup.
    assert!(initial_version_script().contains(env!("CARGO_PKG_VERSION")));
}
