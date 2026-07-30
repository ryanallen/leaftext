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
fn settings_persistence_round_trips_and_falls_back_safely() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-persistence-{unique}"));
    let settings_path = dir.join("config").join("settings.json");
    let missing_path = dir.join("missing.json");

    let settings = Settings {
        minimap_enabled: false,
        pager_enabled: false,
        speed_reader_enabled: true,
        code_intel_enabled: false,
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
    };

    save_settings(&settings_path, &settings).expect("settings save");
    let loaded = load_settings(&settings_path);
    assert_eq!(loaded.settings, settings);
    // Read back cleanly, so there is nothing to tell the page about.
    assert!(!loaded.unreadable);
    // A missing file restores defaults, not the all-false zero value — and is an
    // ordinary first launch, not something to report.
    let missing = load_settings(&missing_path);
    assert_eq!(missing.settings, Settings::default());
    assert!(!missing.unreadable);

    fs::write(&settings_path, "{not json").expect("corrupt settings fixture is written");
    let corrupt = load_settings(&settings_path);
    assert_eq!(corrupt.settings, Settings::default());
    // A file that is there and does not parse is the one case worth a growl:
    // the app is about to look factory-fresh with the file's contents ignored.
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

    // PowerShell's Out-File/Set-Content and Notepad all write a UTF-8 byte order
    // mark by default, so a hand-edited config on Windows arrives with three
    // bytes in front of the opening brace. serde_json refuses them, and every
    // reader here defaults on a parse failure — which silently threw the file
    // away. Both config files must look past the mark.
    let settings_path = dir.join("settings.json");
    fs::write(
        &settings_path,
        "\u{feff}{\"library_width\": 312, \"minimap_enabled\": false}",
    )
    .expect("BOM settings fixture is written");
    let loaded = load_settings(&settings_path);
    assert_eq!(loaded.settings.library_width, 312);
    assert!(!loaded.settings.minimap_enabled);
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

    // Pre-family installs stored Dracula as a theme mode; it becomes the dark
    // half of the Nightshade family (the renamed Dracula palette) on load.
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

    // Only one field present: the rest must fall back to their defaults. An
    // unknown key — `indexing_enabled`, which every already-installed copy still
    // has in its settings file — is ignored rather than failing the load.
    fs::write(
        &settings_path,
        r#"{"library_width": 312, "indexing_enabled": true}"#,
    )
    .expect("partial settings fixture is written");
    let loaded = load_settings(&settings_path).settings;
    assert_eq!(loaded.library_width, 312);
    assert!(loaded.minimap_enabled);
    assert_eq!(loaded.theme_mode, "system");
    assert!(!loaded.library_closed);

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

    // `library_view` was the pane's mode when the graph lived in the sidebar.
    // The graph is a page now and the key is gone, but every installed copy
    // still has it — and an unknown key must be ignored, not fail the whole
    // deserialize and reset every other setting with it.
    for legacy in ["tree", "flat", "project", "graph"] {
        let settings_path = dir.join(format!("{legacy}.json"));
        fs::write(
            &settings_path,
            format!(r#"{{"library_view": "{legacy}", "minimap_enabled": false}}"#),
        )
        .expect("legacy library view fixture is written");
        let loaded = load_settings(&settings_path).settings;
        assert!(!loaded.minimap_enabled);
    }

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn an_unreadable_settings_file_reaches_the_page_as_a_growl() {
    // The whole point of the flag: coming up on defaults is invisible, so the
    // page has to say it. Host side, it is always emitted so the flag is never
    // undefined; page side, the boot growls only when it is true.
    assert_eq!(
        settings_unreadable_script(true),
        "window.__leafSettingsUnreadable = true;"
    );
    assert_eq!(
        settings_unreadable_script(false),
        "window.__leafSettingsUnreadable = false;"
    );

    let html = app_shell_html();
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

/// These paths are where every installed copy already keeps its settings,
/// recent files, and search index, so they are a compatibility contract, not a
/// preference. They were captured from the `directories` crate's
/// `ProjectDirs::from("com", "ryanallen", "leaftext")` before that dependency
/// was replaced with the plain environment lookups in `project_config_dir` and
/// `project_data_local_dir`. Changing either shape silently orphans user data:
/// the app would start up looking clean, with the old settings still on disk.
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
        // macOS draws no roaming/local distinction, so both roots are the one
        // Application Support folder.
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
    // Unknown / missing extensions route through the Markdown renderer, matching
    // how the loader treats everything it does not recognize.
    assert_eq!(
        DocumentFormat::from_path(Path::new("README")),
        DocumentFormat::Markdown
    );
}

/// `for_path` is the "can we open this at all?" question, so unlike `from_path`
/// it must not quietly answer Markdown for a format the app cannot read.
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

/// Every extension the table lists must round-trip back to its own format, and
/// the flat list the file dialog offers must be exactly those extensions. This is
/// the test that keeps a new format from being half-added.
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

/// The installers are the two places the extension list lives outside
/// `format.rs`, and neither can read it at install time: the MSI claims each
/// extension in the registry, the macOS bundle claims them in its Info.plist.
/// This is what keeps a format the app opens from shipping without its
/// double-click — .json, .yaml, .yml, .eml, .mht and .mhtml all did.
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

/// The pager, the file dialog, drag-and-drop, link following and the library index
/// each used to carry their own list. Anything the app can open must page too.
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
    // `.markdown` and `.mdown` open like any other page, so they must also page
    // and lose their extension in the label.
    assert!(is_pager_page_extension("markdown"));
    assert!(is_pager_page_extension("mdown"));
    assert_eq!(pager_label("getting-started.markdown"), "Getting Started");
    assert!(!is_pager_page_extension("png"));
}

#[test]
fn updating_is_not_a_setting() {
    // Updating is what the app does, not an opt-in: no toggle, no string for one.
    let html = app_shell_html();
    assert!(!html.contains("autoUpdateEnabled"));
    assert!(!html.contains("settings.autoUpdate"));
    assert!(!html.contains("setAutoUpdateEnabled"));
    assert!(!html.contains("update.downloadsOff"));

    // Every state the update button can report has wording, or it renders blank.
    for wording in [
        "`Update to v${version}`",
        "`Downloading v${version}… ${percent}%`",
        "'Restart to update'",
        "const UPDATE_FAILED = 'Update failed — open release page';",
        "`Update failed: ${message}`",
        "'Check for updates'",
        "'Ask GitHub for the latest release now'",
        "'Checking…'",
        "'Up to date.'",
        "`Last checked ${ago}.`",
        "'Checked just now.'",
        "`Could not reach GitHub: ${message || ''}`",
        "`Installing v${updateApplyFailure.version} failed:",
        "`GitHub answered ${res.status}`",
        "This release publishes no installer for this platform",
    ] {
        assert_contains(&html, wording);
    }
}

#[test]
fn the_settings_panel_can_check_for_updates_on_demand() {
    // The scheduled check is throttled to hours, so without a control that forces
    // one there is no way to find out whether updating works — the symptom that
    // made the whole updater look broken. The button's label is the status itself,
    // so one control both reports and re-checks; `update.check` is only the text
    // before the first answer.
    let html = app_shell_html();
    assert!(html.contains(r#"<button type="button" class="settings-check" id="settingsCheck">"#));
    assert!(html.contains(r#"<span id="settingsCheckLabel">Check for updates</span>"#));
    // No separate status line to fall back to, so the error color lives here.
    assert!(reading_mode_css().contains(".settings-check.is-error"));
    // The download's progress signals: a spinner and a fill behind the label.
    assert!(html.contains(r#"id="settingsUpdateSpinner""#));
    assert!(html.contains(r#"id="settingsUpdateFill""#));

    let css = reading_mode_css();
    assert!(css.contains(".settings-spinner"));
    // Green for news, amber for a failure: the dot is all a user sees with the
    // panel shut.
    assert!(css.contains(".settings-alert-dot.is-downloading"));
    assert!(css.contains(".settings-alert-dot.is-failed"));
}

#[test]
fn the_settings_panel_shows_the_running_version() {
    let html = app_shell_html();
    assert!(html.contains(r#"<span class="settings-version-number" id="settingsVersion">"#));
    assert!(html.contains("<span>Version</span>"));
    // The number itself comes from the init script, not the markup.
    assert!(initial_version_script().contains(env!("CARGO_PKG_VERSION")));
}
