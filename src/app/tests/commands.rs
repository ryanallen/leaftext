//! The names the page sends a command under.

use super::*;

#[test]
fn a_table_cell_edit_arrives_under_the_names_the_page_sends() {
    // Nothing on this enum rejects an unknown field, so a cell spelled differently on the two sides would deserialize to None and every cell edit would silently go back to rewriting the whole table — which is the fault this was built to fix, back with nothing on screen to show for it.
    let sent = r#"{"command":"editBlock","start":11,"end":60,"text":"the whole table rewritten","cell":{"row":1,"column":0,"columns":1,"text":"2"}}"#;
    match serde_json::from_str::<IpcCommand>(sent) {
        Ok(IpcCommand::EditBlock { start, cell, .. }) => {
            let cell = cell.expect("the cell the page named arrives with the edit");
            assert_eq!((start, cell.row, cell.column, cell.columns), (11, 1, 0, 1));
            assert_eq!(cell.text, "2");
        }
        other => panic!("the cell edit did not arrive: {other:?}"),
    }

    // Every other edit still sends no cell at all, and a table whose cell the page could not place sends it as null.
    for sent in [
        r#"{"command":"editBlock","start":0,"end":5,"text":"Hi"}"#,
        r#"{"command":"editBlock","start":0,"end":5,"text":"Hi","cell":null}"#,
    ] {
        match serde_json::from_str::<IpcCommand>(sent) {
            Ok(IpcCommand::EditBlock { cell, .. }) => assert!(cell.is_none(), "{sent}"),
            other => panic!("the edit did not arrive: {other:?}"),
        }
    }
}

#[test]
fn a_splice_made_while_the_reader_types_arrives_under_the_names_the_page_sends() {
    // Nothing on this enum rejects an unknown field, so either flag spelled differently on the two sides would deserialize to false and fail silently: a splice sent mid-typing would rebuild the page under the caret, and every pause in one sentence would become its own press of undo.
    let sent = r#"{"command":"editBlock","start":9,"end":10,"text":"A paragraph.","live":true,"continuing":true}"#;
    match serde_json::from_str::<IpcCommand>(sent) {
        Ok(IpcCommand::EditBlock {
            live, continuing, ..
        }) => assert!(live && continuing),
        other => panic!("the live splice did not arrive: {other:?}"),
    }

    // And a commit that ends the typing renders and records its own step, which is what every edit that says nothing about either flag has to be.
    match serde_json::from_str::<IpcCommand>(
        r#"{"command":"editBlock","start":0,"end":5,"text":"Hi"}"#,
    ) {
        Ok(IpcCommand::EditBlock {
            live, continuing, ..
        }) => assert!(!live && !continuing),
        other => panic!("the edit did not arrive: {other:?}"),
    }
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

/// The two commands a press on the app bar can send. The page decides which by the click count and whether the window stayed put; the host only has to tell them apart, and nothing else covers that it can.
#[test]
fn the_app_bar_sends_a_drag_and_a_maximize_under_the_names_the_page_uses() {
    assert!(matches!(
        serde_json::from_str::<IpcCommand>(r#"{"command":"windowDrag"}"#),
        Ok(IpcCommand::WindowDrag)
    ));
    assert!(matches!(
        serde_json::from_str::<IpcCommand>(r#"{"command":"windowToggleMaximize"}"#),
        Ok(IpcCommand::WindowToggleMaximize)
    ));
}
