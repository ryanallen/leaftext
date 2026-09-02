//! Host-to-page script generators: document state, navigation, scroll handoff.

use super::*;

/// A clean tab in the strip — no unsaved edits, nothing to take back.
fn strip_tab(title: &str, path: &str) -> TabSummary {
    TabSummary {
        title: title.to_string(),
        path: path.to_string(),
        dirty: false,
        undoable: false,
        redoable: false,
        untitled: false,
    }
}

#[test]
fn navigation_state_script_updates_webview_navigation_controls() {
    assert_eq!(
        navigation_state_script(true, false),
        r#"window.leafSetNavigation({"canGoBack":true,"canGoForward":false});"#
    );
}

#[test]
fn initial_state_script_returns_reader_to_no_file_state_with_both_lists() {
    // Both, because the start screen draws both and nothing else answers for the first paint: sent with recents alone, the Favorites column came up empty on every launch and only filled once some later state arrived.
    let favorites = Favorites {
        entries: vec![Favorite {
            vault_id: Some(3),
            path: PathBuf::from("NOTES.md"),
            kind: FavoriteKind::Document,
        }],
    };
    let script = initial_state_script(&[PathBuf::from("README.md")], &favorites, &[], None);

    assert_eq!(
        script,
        r#"window.__leafInitialState = {"active":null,"document":null,"favorites":[{"kind":"document","path":"NOTES.md","vaultId":3}],"recent":["README.md"],"tabs":[]};"#
    );
}

#[test]
fn initial_state_script_carries_restored_tab_labels_without_a_document() {
    let tabs = [strip_tab("Guide", "guide.md")];
    let script = initial_state_script(&[], &Favorites::default(), &tabs, Some(0));

    assert_contains(
        &script,
        r#""tabs":[{"dirty":false,"path":"guide.md","redoable":false,"title":"Guide","undoable":false,"untitled":false}]"#,
    );
    assert_contains(&script, r#""active":0"#);
    assert_contains(&script, r#""document":null"#);

    // A tab the last close left unsaved says so in the same payload, and so does one whose reader undid a step and can bring it back: the page's own maps of both start empty at launch, so a restored dot and a restored Redo button have nowhere else to come from.
    let restored = [TabSummary {
        dirty: true,
        undoable: true,
        redoable: true,
        untitled: false,
        ..strip_tab("Guide", "guide.md")
    }];
    assert_contains(
        &initial_state_script(&[], &Favorites::default(), &restored, Some(0)),
        r#""tabs":[{"dirty":true,"path":"guide.md","redoable":true,"title":"Guide","undoable":true,"untitled":false}]"#,
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
    let tabs = [strip_tab("Guide", "guide.md")];
    let script = workspace_reload_script(
        &[PathBuf::from("guide.md")],
        &Favorites::default(),
        &tabs,
        Some(0),
        None,
        None,
    );

    // The reload path must call leafReloadDocument (which keeps the reader's scroll position), never leafSetState (which jumps back to the top).
    assert!(script.starts_with("window.leafReloadDocument({"));
    assert!(!script.contains("leafSetState"));
    assert_contains(&script, r#""active":0"#);
    assert_contains(&script, r#""title":"Guide""#);
}

#[test]
fn workspace_payload_carries_favorites_beside_recents() {
    let tabs = [strip_tab("Guide", "guide.md")];
    let mut favorites = Favorites::default();
    favorites.add(Favorite {
        vault_id: Some(4),
        path: PathBuf::from("notes/archive"),
        kind: FavoriteKind::Folder,
    });
    favorites.add(Favorite {
        vault_id: None,
        path: PathBuf::from("scratch.md"),
        kind: FavoriteKind::Document,
    });

    // Every screen reads this one payload, so a sender left out of it would never hear about a mark.
    for script in [
        workspace_state_script(&[], &favorites, &tabs, Some(0), None, None),
        workspace_only_script(&[], &favorites, &tabs, Some(0)),
        workspace_reload_script(&[], &favorites, &tabs, Some(0), None, None),
        workspace_switch_script(&[], &favorites, &tabs, Some(0), None, None, None),
    ] {
        assert_contains(&script, r#""kind":"folder""#);
        assert_contains(&script, r#""vaultId":4"#);
        assert_contains(&script, r#""vaultId":null"#);
        assert_contains(&script, r#""path":"scratch.md""#);
    }
}

#[test]
fn all_four_workspace_scripts_carry_the_same_fields() {
    fn payload(script: &str) -> serde_json::Value {
        let start = script.find('(').expect("the call opens") + 1;
        let mut values =
            serde_json::Deserializer::from_str(&script[start..]).into_iter::<serde_json::Value>();
        values.next().expect("the payload is there").expect("JSON")
    }

    let document = opened_document_from_source("# Guide", "guide.md");
    let tabs = [strip_tab("Guide", "guide.md")];
    let expected = payload(&workspace_state_script(
        &[PathBuf::from("guide.md")],
        &Favorites::default(),
        &tabs,
        Some(0),
        Some(&document),
        None,
    ));
    for script in [
        workspace_reload_script(
            &[PathBuf::from("guide.md")],
            &Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
            None,
        ),
        workspace_switch_script(
            &[PathBuf::from("guide.md")],
            &Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
            None,
            None,
        ),
    ] {
        assert_eq!(payload(&script), expected);
    }
    for message in [
        workspace_state_message(
            &[PathBuf::from("guide.md")],
            &Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
            None,
        ),
        workspace_reload_message(
            &[PathBuf::from("guide.md")],
            &Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
            None,
        ),
        workspace_switch_message(
            &[PathBuf::from("guide.md")],
            &Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
            None,
            None,
        ),
    ] {
        let staged: serde_json::Value =
            serde_json::from_slice(message.shared_json()).expect("staged workspace JSON");
        assert_eq!(staged, expected);
    }

    let workspace = payload(&workspace_only_script(
        &[PathBuf::from("guide.md")],
        &Favorites::default(),
        &tabs,
        Some(0),
    ));
    let mut without_document = expected;
    without_document["document"] = serde_json::Value::Null;
    without_document["renderKey"] = serde_json::Value::Null;
    assert_eq!(workspace, without_document);
}

#[test]
fn a_workspace_payload_escapes_every_document_string() {
    let special = "a \\\"quote\\\", a \\\\ slash, and </script>";
    let mut document = opened_document_from_source("# Seed", "seed.md");
    document.title = special.to_string();
    document.path = special.to_string();
    document.source = special.to_string();
    let script =
        workspace_state_script(&[], &Favorites::default(), &[], None, Some(&document), None);
    let start = script.find('(').expect("the call opens") + 1;
    let payload = serde_json::Deserializer::from_str(&script[start..])
        .into_iter::<serde_json::Value>()
        .next()
        .expect("the payload is there")
        .expect("JSON");

    assert_eq!(payload["document"]["title"], special);
    assert_eq!(payload["document"]["path"], special);
    assert_eq!(payload["document"]["source"], special);
    let message =
        workspace_state_message(&[], &Favorites::default(), &[], None, Some(&document), None);
    let staged: serde_json::Value =
        serde_json::from_slice(message.shared_json()).expect("staged workspace JSON");
    assert_eq!(staged["document"]["title"], special);
    assert_eq!(staged["document"]["path"], special);
    assert_eq!(staged["document"]["source"], special);
}

#[test]
fn workspace_switch_script_restores_target_tab_anchor_without_reset() {
    let tabs = [strip_tab("Guide", "guide.md")];
    let anchor = ScrollAnchor {
        section: Some("intro".to_string()),
        block: 2,
        offset_y: 12.5,
    };
    let script = workspace_switch_script(
        &[PathBuf::from("guide.md")],
        &Favorites::default(),
        &tabs,
        Some(0),
        None,
        Some(&anchor),
        None,
    );

    // Switching must render through leafSwitchTab (renders, then restores the saved anchor) rather than leafSetState (which snaps back to the top).
    assert!(script.starts_with("window.leafSwitchTab({"));
    assert!(!script.contains("leafSetState"));
    assert_contains(&script, r#""active":0"#);
    assert!(script.ends_with(r#", {"section":"intro","block":2,"offsetY":12.5});"#));

    // No saved anchor (first visit to a tab) passes null, which starts the reader at the top of the content.
    assert!(
        workspace_switch_script(&[], &Favorites::default(), &[], None, None, None, None)
            .ends_with(", null);")
    );
}

#[test]
fn full_document_handoffs_carry_the_exact_render_key_and_cached_switches_carry_no_document() {
    let document = opened_document_from_source("# ONLY_IN_THE_DOCUMENT", "guide.md");
    let tabs = [strip_tab("Guide", "guide.md")];
    let hash = 0x12ab_u64;
    let key = r#""renderKey":"00000000000012ab""#;
    for script in [
        workspace_state_script(
            &[],
            &Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
            Some(hash),
        ),
        workspace_reload_script(
            &[],
            &Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
            Some(hash),
        ),
        workspace_switch_script(
            &[],
            &Favorites::default(),
            &tabs,
            Some(0),
            Some(&document),
            None,
            Some(hash),
        ),
    ] {
        assert_contains(&script, key);
        assert_contains(&script, "ONLY_IN_THE_DOCUMENT");
    }

    let cached = workspace_cached_switch_script(
        &[],
        &Favorites::default(),
        &tabs,
        Some(0),
        Some(&ScrollAnchor {
            section: Some("place".to_string()),
            block: 2,
            offset_y: 3.0,
        }),
        hash,
    );
    assert!(cached.starts_with("window.leafSwitchTabCached({"));
    assert_contains(&cached, key);
    assert_contains(&cached, r#""section":"place""#);
    assert!(!cached.contains("ONLY_IN_THE_DOCUMENT"));
}

#[test]
fn document_state_script_never_serializes_raw_title_markup() {
    let path = scratch_dir("title-state").join("document.md");
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
        session: Session::default(),
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
        hint_launches: 3,
        hints_seen: vec!["libraryVault".to_string()],
        hint_last_launch: 2,
    });
    // Window geometry is host-only (applied to the native window, not the webview), so it must not leak into the injected settings global. The update fields do cross: the page owns the check throttle and the button.
    assert_eq!(
        script,
        r#"window.__leafSettings = {"codeIntelEnabled":false,"codeUnlocked":false,"graphScope":"large","hintLastLaunch":2,"hintLaunches":3,"hintsSeen":["libraryVault"],"libraryClosed":true,"libraryProjectPath":"docs","libraryWidth":312,"readingUnlocked":true,"speedReaderEnabled":true,"themeFamily":"nightshade","themeMode":"dark","themeRandomUsed":[],"updateLastChecked":1780000000,"updateStagedVersion":"0.1.400"};"#
    );
}

/// The operating system's own accessibility answer, always emitted so the page never reads an undefined flag, and its own global rather than a field on the settings above — the app keeps no copy of somebody else's answer.
#[test]
fn the_scrollbars_always_flag_is_its_own_global_and_is_always_emitted() {
    assert_eq!(
        scrollbars_always_script(true),
        "window.__leafScrollbarsAlways = true;"
    );
    assert_eq!(
        scrollbars_always_script(false),
        "window.__leafScrollbarsAlways = false;"
    );

    // Never one of the persisted switches: a copy in settings.json outlives the reader changing their mind.
    assert!(
        !initial_settings_script(&Settings::default()).contains("crollbars"),
        "the platform's answer is being persisted as one of the app's own switches"
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

/// The corner message a failed open draws is composed in the page, so the host owes it two values rather than a sentence: the path first, then a reason with this file's name already taken off it. Swap them and the page says the reason is the file.
#[test]
fn an_open_error_script_keeps_the_path_and_reason_as_separate_values() {
    assert_eq!(
        open_error_state_script(
            Path::new("C:/notes/broken.md"),
            r#"Reason with "quotes" and a \ backslash"#
        ),
        r#"window.leafShowOpenError("C:/notes/broken.md", "Reason with \"quotes\" and a \\ backslash");"#
    );
}

/// The page refreshes every remembered link answer.
#[test]
fn aging_the_link_cards_is_one_call_carrying_no_address() {
    assert_eq!(age_link_previews_script(), "window.leafAgeLinkPreviews();");
}

#[test]
fn link_preview_script_keeps_document_markup_out_of_javascript_syntax() {
    assert_eq!(
        link_preview_script(7, "<p>\"quoted\"</p>"),
        r#"window.leafLinkPreview(7, "<p>\"quoted\"</p>");"#
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
    /// Names the page owns. `leafShowCodeView` it calls itself after fetching the payload, and `leafShowSaveError` the same way, from the save report the host does call; the next two are state one fragment publishes for the rest, each with a `subscribe` — the shape new shared state should copy. `leafSetFavorites` is called by the browser host, whose stand-in test executes that call rather than this Rust-host scan reading it. The last two are forcing switches for the first-run bubble, driven from outside over `eval` so one can be looked at without a fresh install; nothing in the host reaches them, and that is the point.
    const PAGE_ONLY: &[&str] = &[
        "window.leafShowCodeView",
        "window.leafShowSaveError",
        "window.leafMinimap",
        "window.leafTheme",
        "window.leafSetFavorites",
        "window.leafShowHint",
        "window.leafResetHints",
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
