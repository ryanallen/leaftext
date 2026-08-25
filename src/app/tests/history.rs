//! Back, forward, and the place a document was left at.

use super::*;

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

    // An in-place rebuild says nothing on purpose, which is what tells the page to carry the place off the editor it is replacing.
    assert_eq!(
        code_view_scroll(&ScrollIntent::Preserve { code: None }),
        None
    );

    // Except a rename, whose moved path is exactly what makes the page refuse that capture, so the host names the place instead.
    assert_eq!(
        code_view_scroll(&ScrollIntent::Preserve { code: Some(0.61) }),
        Some(0.61)
    );
}

#[test]
fn the_source_payload_carries_a_saved_place_and_says_nothing_when_there_is_none() {
    // The field's absence is the page's instruction to use its own answer instead, so a fraction of zero has to arrive as a zero rather than as nothing: a tab saved at the top of its source is still a tab with a saved place.
    let saved = code_view_payload("# Title", "markdown", "Markdown", false, Some(0.42));
    assert!(saved.contains("\"scrollFraction\":0.42"), "{saved}");

    let top = code_view_payload("# Title", "markdown", "Markdown", false, Some(0.0));
    assert!(top.contains("\"scrollFraction\":0.0"), "{top}");

    let none = code_view_payload("# Title", "markdown", "Markdown", false, None);
    assert!(!none.contains("scrollFraction"), "{none}");
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
