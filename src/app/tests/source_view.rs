//! The raw source view and the payload it fetches.

use super::*;

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

/// One code-view payload is held at a time on purpose, so a test that stages one takes this until it is done with the slot — on the harness's threads another test's staging supersedes it and the read is a 404. Poison is shrugged off so one broken test is one failure.
static SOURCE_PAYLOAD_SLOT: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn a_staged_source_payload_is_served_with_the_headers_the_fetch_needs() {
    let _slot = SOURCE_PAYLOAD_SLOT
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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
    let _slot = SOURCE_PAYLOAD_SLOT
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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
fn the_reading_view_handoff_keeps_the_document_out_of_the_page_command() {
    let _slot = SOURCE_PAYLOAD_SLOT
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let document = OpenedDocument {
        title: "large".to_string(),
        path: "C:\\Notes\\large.txt".to_string(),
        html: String::new(),
        has_visible_content: false,
        format: DocumentFormat::Text,
        blocks: Vec::new(),
        tasks: Vec::new(),
        source: "huge document".to_string(),
        dialect: None,
    };
    let message =
        workspace_state_message(&[], &Favorites::default(), &[], None, Some(&document), None);
    let script = message.stage_with(stage_page_payload);

    assert!(script.contains("leafLoadWorkspace"), "{script}");
    assert!(
        !script.contains("huge document"),
        "the page command must not carry the document: {script}"
    );
    assert!(
        script.len() < 200,
        "the page command should carry only a URL: {script}"
    );
    let url = script
        .split('"')
        .nth(1)
        .expect("the page command carries its payload URL");
    let served = source_payload_response(url);
    let json: serde_json::Value = serde_json::from_slice(&served.body).expect("payload is JSON");
    assert_eq!(json["document"]["source"], "huge document");

    let message =
        workspace_state_message(&[], &Favorites::default(), &[], None, Some(&document), None);
    let metadata: serde_json::Value =
        serde_json::from_str(&message.shared_metadata()).expect("shared-buffer route is JSON");
    assert_eq!(metadata["action"], "state");
    assert_eq!(metadata["detail"], serde_json::Value::Null);
}

/// The one test holding what the code view carries end to end: the payload test above builds one out of a made-up string, and the two tests entering the view take the arm where the file has gone.
#[test]
fn entering_the_code_view_stages_the_buffers_whole_text() {
    let _slot = SOURCE_PAYLOAD_SLOT
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let dir = scratch_dir("entering_the_code_view_stages_the_buffers_whole_text");
    let path = dir.join("source.md");
    // Long enough that a payload carrying a truncation rather than the buffer is visible, and spelled so no other staged body could match it.
    let source = format!(
        "# Heading\n\n{}\n",
        "a paragraph nobody trims\n".repeat(400)
    );
    fs::write(&path, &source).expect("the document is written");

    // The slot's next id is one past the one this marker took, and the serial itself is private to the command.
    let marker = stage_source_payload("{}".to_string());
    let staged = marker
        .rsplit('/')
        .next()
        .and_then(|id| id.parse::<u64>().ok())
        .expect("the staged URL ends in its id")
        + 1;

    let mut workspace = Workspace::default();
    workspace.open_path(path.clone());
    assert_eq!(enter_code_view(None, &mut workspace, None), Ok(()));

    let served = source_payload_response(&source_payload_url(SOURCE_PAYLOAD_PROTOCOL, staged));
    assert_eq!(served.status, 200, "the code view staged its payload");
    let json: serde_json::Value = serde_json::from_slice(&served.body).expect("payload is JSON");
    assert_eq!(
        json["text"], source,
        "the page is owed the buffer's whole text, byte for byte"
    );
    assert_eq!(json["language"], "markdown");
    assert_eq!(json["dirty"], false);
    assert!(workspace.tabs[0].code_view, "the tab is left in the view");

    let _ = fs::remove_dir_all(&dir);
}
