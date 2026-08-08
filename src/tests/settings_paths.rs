//! Settings, recent files, the format table, and on-disk locations.

use super::*;

#[test]
fn opening_document_records_recent_file_and_persists_it() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-open-document-{unique}"));
    let document_path = dir.join("Guide.md");
    let config_path = dir.join("settings").join("recent-files.json");
    fs::create_dir_all(&dir).expect("test directory is created");
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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("leaf-missing-document-{unique}.md"));
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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-recent-save-error-{unique}"));
    let document_path = dir.join("Release.md");
    fs::create_dir_all(&dir).expect("test directory is created");
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

    for index in 0..10 {
        recent.record(PathBuf::from(format!("file-{index}.md")));
    }
    recent.record(PathBuf::from("file-5.md"));

    assert_eq!(recent.files.first(), Some(&PathBuf::from("file-5.md")));
    assert_eq!(recent.files.len(), MAX_RECENT_FILES);
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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-recent-persistence-{unique}"));
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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-favorites-persistence-{unique}"));
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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-favorites-older-config-{unique}"));
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
fn settings_persistence_round_trips_and_falls_back_safely() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-persistence-{unique}"));
    let settings_path = dir.join("config").join("settings.json");
    let missing_path = dir.join("missing.json");

    let settings = Settings {
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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-bom-{unique}"));
    fs::create_dir_all(&dir).expect("test directory is created");

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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-migrate-{unique}"));
    let settings_path = dir.join("settings.json");
    fs::create_dir_all(&dir).expect("test directory is created");

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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-partial-{unique}"));
    let settings_path = dir.join("settings.json");
    fs::create_dir_all(&dir).expect("test directory is created");

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
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-library-view-{unique}"));
    fs::create_dir_all(&dir).expect("test directory is created");

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

/// These paths are where every installed copy already keeps its settings, recent files, and vault registry, so they are a compatibility contract, not a preference. They were captured from the `directories` crate's `ProjectDirs::from("com", "ryanallen", "leaftext")` before that dependency was replaced with the plain environment lookups in `project_config_dir` and `project_data_local_dir`. Changing either shape silently orphans user data: the app would start up looking clean, with the old settings still on disk.
#[test]
fn project_dirs_match_the_documented_layout() {
    let config = project_config_dir().expect("config directory is available");
    let data = project_data_local_dir().expect("data directory is available");

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
        "notes.txt",
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
    for format in DocumentFormat::ALL {
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
    assert_eq!(all_document_extensions(), listed);
}

/// The installers are the two places the extension list lives outside `format.rs`, and neither can read it at install time: the MSI claims each extension in the registry, the macOS bundle claims them in its Info.plist. This is what keeps a format the app opens from shipping without its double-click — .json, .yaml, .yml, .eml, .mht and .mhtml all did.
#[test]
fn installer_claims_every_readable_extension() {
    let wxs = include_str!("../../wix/main.wxs");
    let plist = include_str!("../../.github/workflows/release-distributions.yml");

    for extension in all_document_extensions() {
        // The closing quote matters: .mht must not pass on .mhtml's entry.
        for needle in [
            format!(r"Key='Software\Classes\.{extension}'"),
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

/// An entry that claims a file type and names no icon leaves Finder nothing to draw for that type, whoever the default handler is — which is why every `.md` file on a Mac was a blank page while the app itself wore the leaf. The plain text entry is the one that claims no extensions, on purpose, so an icon there would mark files the app never claimed.
#[test]
fn every_macos_file_type_claiming_extensions_names_the_icon() {
    let workflow = include_str!("../../.github/workflows/release-distributions.yml");
    let entries = macos_document_type_entries();
    assert_eq!(entries.len(), 6, "the bundle claims six file types");

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

/// The pager, the file dialog, drag-and-drop, link following and the library pane all ask `format.rs` rather than carrying a list. Anything the app can open must page too.
#[test]
fn every_readable_format_is_a_pager_page_and_an_in_app_link() {
    for extension in all_document_extensions() {
        assert!(
            is_pager_page_extension(extension),
            ".{extension} opens but Prev/Next skips it"
        );
        assert!(
            is_pager_page_extension(&extension.to_ascii_uppercase()),
            ".{extension} uppercase should page too"
        );
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
