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

    // The reload path must call leafReloadDocument (which keeps the reader's scroll position), never leafSetState (which jumps back to the top).
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

    // Switching must render through leafSwitchTab (renders, then restores the saved anchor) rather than leafSetState (which snaps back to the top).
    assert!(script.starts_with("window.leafSwitchTab({"));
    assert!(!script.contains("leafSetState"));
    assert_contains(&script, r#""active":0"#);
    assert!(script.ends_with(r#", {"section":"intro","block":2,"offsetY":12.5});"#));

    // No saved anchor (first visit to a tab) passes null, which starts the reader at the top of the content.
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
        speed_reader_enabled: true,
        code_intel_enabled: false,
        reading_unlocked: true,
        code_unlocked: false,
        theme_family: "nightshade".to_string(),
        theme_mode: "dark".to_string(),
        theme_random_used: Vec::new(),
        graph_scope: GraphScope::Large,
        library_project_path: "docs".to_string(),
        library_closed: true,
        library_width: 312,
        window_width: 1440,
        window_height: 960,
        window_maximized: true,
        update_last_checked: 1_780_000_000,
        update_staged_version: "0.1.400".to_string(),
        update_auto_applied: String::new(),
    });
    // Window geometry is host-only (applied to the native window, not the webview), so it must not leak into the injected settings global. The update fields do cross: the page owns the check throttle and the button.
    assert_eq!(
        script,
        r#"window.__leafSettings = {"codeIntelEnabled":false,"codeUnlocked":false,"graphScope":"large","libraryClosed":true,"libraryProjectPath":"docs","libraryWidth":312,"readingUnlocked":true,"speedReaderEnabled":true,"themeFamily":"nightshade","themeMode":"dark","themeRandomUsed":[],"updateLastChecked":1780000000,"updateStagedVersion":"0.1.400"};"#
    );
}

#[test]
fn initial_version_script_exposes_the_package_version() {
    // The frontend's update check reads window.__leafVersion to compare against the latest GitHub release, so it must carry the built package version.
    let script = initial_version_script();
    assert_eq!(
        script,
        format!("window.__leafVersion = {:?};", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn glossary_failed_script_gives_the_page_a_reason_to_show() {
    assert_eq!(
        glossary_failed_script("missing"),
        r#"window.leafGlossaryFailed("missing");"#
    );
}

#[test]
fn a_taken_code_view_edit_reports_only_the_dirty_state() {
    // The editor owns what is on screen, so the acknowledgment says nothing about the text: no colored markup, and no copy of the buffer coming back down the channel the edit just went out on.
    let taken = source_updated_script(true);
    assert_contains(&taken, r#""dirty":true"#);
    assert!(taken.starts_with("window.leafSourceUpdated("));
    assert!(!taken.contains("html"), "no markup rides along: {taken}");

    assert_contains(&source_updated_script(false), r#""dirty":false"#);
}

/// The two sides are joined by a name in a string, so a rename on one side is a silent no-op at runtime. Every name the host emits must exist in the page, and every one the page defines must be reached.
#[test]
fn the_host_and_the_page_agree_on_every_call() {
    /// Names the page owns. `leafShowCodeView` it calls itself after fetching the payload; the other two are state one fragment publishes for the rest, each with a `subscribe` — the shape new shared state should copy.
    const PAGE_ONLY: &[&str] = &[
        "window.leafShowCodeView",
        "window.leafMinimap",
        "window.leafTheme",
    ];

    fn leaf_calls(text: &str) -> std::collections::BTreeSet<String> {
        let mut found = std::collections::BTreeSet::new();
        for (index, _) in text.match_indices("window.leaf") {
            let rest = &text[index..];
            let end = rest
                .char_indices()
                .find(|(offset, ch)| *offset > 0 && !ch.is_ascii_alphanumeric() && *ch != '.')
                .map(|(offset, _)| offset)
                .unwrap_or(rest.len());
            let name = &rest[..end];
            // `window.leafSetGraph` yes, a bare `window.leaf` no.
            if name.len() > "window.leaf".len() {
                found.insert(name.to_string());
            }
        }
        found
    }

    // What the host emits, across every file that builds a script.
    let source_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut host_calls = std::collections::BTreeSet::new();
    let mut rust_files = Vec::new();
    for directory in [source_dir.clone(), source_dir.join("app")] {
        let entries = std::fs::read_dir(&directory).expect("source directory is readable");
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                rust_files.push(path);
            }
        }
    }
    assert!(
        rust_files.len() > 10,
        "expected to scan the whole source tree, found {} files",
        rust_files.len()
    );
    for path in rust_files {
        let text = std::fs::read_to_string(&path).expect("source file is readable");
        host_calls.extend(leaf_calls(&text));
    }

    // Assignments only: a call inside the page is not a definition.
    let html = app_shell_page();
    let page_defines: std::collections::BTreeSet<String> = html
        .match_indices(" = ")
        .filter_map(|(index, _)| {
            let before = &html[..index];
            let start = before.rfind(|ch: char| ch.is_whitespace() || ch == ';')? + 1;
            let name = before[start..].trim();
            name.starts_with("window.leaf").then(|| name.to_string())
        })
        .collect();

    let missing: Vec<&String> = host_calls.difference(&page_defines).collect();
    assert!(
        missing.is_empty(),
        "the host calls page functions that do not exist: {missing:?}"
    );

    let unused: Vec<&String> = page_defines
        .difference(&host_calls)
        .filter(|name| !PAGE_ONLY.contains(&name.as_str()))
        .collect();
    assert!(
        unused.is_empty(),
        "the page defines functions no host call reaches: {unused:?}"
    );
}
