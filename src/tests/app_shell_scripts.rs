//! Host-to-page script generators: document state, navigation, scroll handoff.

use super::*;

#[test]
fn navigation_state_script_updates_webview_navigation_controls() {
    assert_eq!(
        navigation_state_script(true, false),
        r#"window.leafSetNavigation({"canGoBack":true,"canGoForward":false});"#
    );
}

#[test]
fn initial_state_script_returns_reader_to_no_file_state_with_recent_files() {
    let script = initial_state_script(&[PathBuf::from("README.md")]);

    assert_eq!(
        script,
        r#"window.__leafInitialState = {"document":null,"recent":["README.md"]};"#
    );
}

#[test]
fn scroll_anchor_script_restores_webview_reader_anchor() {
    assert_eq!(
        scroll_anchor_script(&ScrollAnchor {
            section: Some("the-asuras".to_string()),
            block: 3,
            offset_y: -88.0,
        }),
        r#"window.leafRestoreScrollAnchor({"section":"the-asuras","block":3,"offsetY":-88.0});"#
    );
    // A position above the first heading carries a null section.
    assert_eq!(
        scroll_anchor_script(&ScrollAnchor::default()),
        r#"window.leafRestoreScrollAnchor({"section":null,"block":0,"offsetY":0.0});"#
    );
}

#[test]
fn workspace_reload_script_preserves_scroll_via_reload_entry_point() {
    let tabs = [("Guide".to_string(), "guide.md".to_string())];
    let script = workspace_reload_script(&[PathBuf::from("guide.md")], &tabs, Some(0), None);

    // The reload path must call leafReloadDocument (which keeps the reader's
    // scroll position), never leafSetState (which jumps back to the top).
    assert!(script.starts_with("window.leafReloadDocument({"));
    assert!(!script.contains("leafSetState"));
    assert_contains(&script, r#""active":0"#);
    assert_contains(&script, r#""title":"Guide""#);
}

#[test]
fn workspace_switch_script_restores_target_tab_anchor_without_reset() {
    let tabs = [("Guide".to_string(), "guide.md".to_string())];
    let anchor = ScrollAnchor {
        section: Some("intro".to_string()),
        block: 2,
        offset_y: 12.5,
    };
    let script = workspace_switch_script(
        &[PathBuf::from("guide.md")],
        &tabs,
        Some(0),
        None,
        Some(&anchor),
    );

    // Switching must render through leafSwitchTab (renders, then restores the
    // saved anchor) rather than leafSetState (which snaps back to the top).
    assert!(script.starts_with("window.leafSwitchTab({"));
    assert!(!script.contains("leafSetState"));
    assert_contains(&script, r#""active":0"#);
    assert!(script.ends_with(r#", {"section":"intro","block":2,"offsetY":12.5});"#));

    // No saved anchor (first visit to a tab) passes null, which starts the
    // reader at the top of the content.
    assert!(workspace_switch_script(&[], &[], None, None, None).ends_with(", null);"));
}

#[test]
fn document_state_script_never_serializes_raw_title_markup() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("leaf-title-state-{unique}.md"));
    fs::write(
        &path,
        r#"# <div align="center">Words &amp; My Perfect Teacher</div>

![Image alt](cover.png)
"#,
    )
    .expect("test markdown is written");

    let document = load_document(&path).expect("test markdown loads");
    let script = document_state_script(&document, &[]);

    fs::remove_file(&path).expect("test markdown is removed");

    assert_eq!(document.title, "Words & My Perfect Teacher");
    assert_contains(&script, r#""title":"Words & My Perfect Teacher""#);
    assert!(!script.contains(r#""title":"<div"#));
    assert!(!script.contains(r#""title":"Words &amp;"#));
}

#[test]
fn fragment_scroll_script_escapes_fragment_for_webview_handoff() {
    assert_eq!(
        fragment_scroll_script(r#"Section "One""#),
        r#"window.leafScrollToFragment("Section \"One\"");"#
    );
}

#[test]
fn initial_settings_script_defines_camelcase_global() {
    let script = initial_settings_script(&Settings {
        indexing_enabled: true,
        minimap_enabled: false,
        pager_enabled: false,
        speed_reader_enabled: true,
        line_numbers_enabled: false,
        reader_editing_enabled: false,
        theme_family: "nightshade".to_string(),
        theme_mode: "dark".to_string(),
        theme_random_used: Vec::new(),
        library_view: LibraryView::Graph,
        graph_scope: GraphScope::Large,
        library_project_path: "docs".to_string(),
        library_closed: true,
        library_width: 312,
        window_width: 1440,
        window_height: 960,
        window_maximized: true,
        auto_update_enabled: true,
        update_last_checked: 1_780_000_000,
        update_staged_version: "0.1.400".to_string(),
        update_auto_applied: String::new(),
    });
    // Window geometry is host-only (applied to the native window, not the
    // webview), so it must not leak into the injected settings global. The
    // update fields do cross: the page owns the check throttle and the button.
    assert_eq!(
        script,
        r#"window.__leafSettings = {"autoUpdateEnabled":true,"graphScope":"large","indexingEnabled":true,"libraryClosed":true,"libraryProjectPath":"docs","libraryView":"graph","libraryWidth":312,"lineNumbersEnabled":false,"minimapEnabled":false,"pagerEnabled":false,"readerEditingEnabled":false,"speedReaderEnabled":true,"themeFamily":"nightshade","themeMode":"dark","themeRandomUsed":[],"updateLastChecked":1780000000,"updateStagedVersion":"0.1.400"};"#
    );
}

#[test]
fn initial_version_script_exposes_the_package_version() {
    // The frontend's update check reads window.__leafVersion to compare against
    // the latest GitHub release, so it must carry the built package version.
    let script = initial_version_script();
    assert_eq!(
        script,
        format!("window.__leafVersion = {:?};", env!("CARGO_PKG_VERSION"))
    );
}
