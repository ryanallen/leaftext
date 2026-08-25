//! The growls that carry a path a reader can press.

use super::*;

/// Where a diagram is to go, answered against the export that asked. The path travels as its own value because the page reads the format off its ending — a path mangled into a sentence would name no format at all.
#[test]
fn the_answer_to_where_a_diagram_goes_carries_the_path_against_its_own_export() {
    let script = diagram_path_picked_script(7, r#"C:\charts\a "quoted" diagram.webp"#);
    assert!(script.starts_with("window.leafDiagramPathPicked(7, "));
    // JSON, so a backslash in a Windows path and a quote in a name reach the page as themselves rather than ending the string early.
    assert!(
        script.contains(r#""C:\\charts\\a \"quoted\" diagram.webp""#),
        "{script}"
    );
}

/// What the host says after a delete, and the two things the page reads off it: the path it may ask back, and the name to show.
#[test]
fn the_message_after_a_delete_carries_the_path_and_the_name() {
    let script = file_deleted_script(r#"C:\notes\a "quoted" note.md"#, r#"a "quoted" note.md"#);
    assert!(script.starts_with("window.leafFileDeleted("));
    // Both are JSON, so a backslash in a Windows path and a quote in a name reach the page as themselves rather than ending the string early.
    assert!(
        script.contains(r#""C:\\notes\\a \"quoted\" note.md""#),
        "{script}"
    );
    assert!(script.contains(r#""a \"quoted\" note.md""#), "{script}");
}

/// What the host says after a file is written, and the one thing the page reads off it: the path, as its own value, so the growl can draw it as a press rather than dig it back out of the sentence.
#[test]
fn the_message_after_a_file_is_written_carries_the_path_it_can_open() {
    let script = file_written_notice_script(r#"C:\reports\a "quoted" page.pdf"#);
    assert!(script.starts_with("window.leafFileWritten("));
    // JSON, so a backslash in a Windows path and a quote in a name reach the page as themselves rather than ending the string early.
    assert!(
        script.contains(r#""C:\\reports\\a \"quoted\" page.pdf""#),
        "{script}"
    );
}
