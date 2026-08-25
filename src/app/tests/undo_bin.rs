//! Deleting a file and putting it back.

use super::*;

/// A folder of this run's own per undo test. These delete real files into the real Recycle Bin, and two runs sharing a folder would each be putting the other's file back.
#[cfg(windows)]
fn undo_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("leaf-undo-{}-{name}", std::process::id()))
}

/// Deleted and put back, against the real Recycle Bin. The whole of the undo is a claim about the shell, so a test that mocked it would prove nothing — this one deletes a file of its own and asks for it back.
#[test]
#[cfg(windows)]
fn undo_restores_a_deleted_file_to_its_folder_under_its_own_name() {
    let folder = undo_dir("delete-test");
    let _ = fs::create_dir_all(&folder);
    let file = folder.join("a note.md");
    fs::write(&file, b"the words that have to survive").expect("write the fixture");

    let landed = delete_to_trash(&file).expect("the delete works");
    assert!(!file.exists(), "the file left the folder");

    restore_from_trash(&file, landed.as_deref()).expect("the file comes back");
    assert!(file.exists(), "back in the folder it came from");
    assert_eq!(
        fs::read(&file).expect("read it back"),
        b"the words that have to survive",
        "and it is the same file, not an empty one of the same name"
    );

    let _ = fs::remove_dir_all(&folder);
}

/// A name taken back before the undo. The shell's own move overwrites without asking once it is told not to confirm, so the refusal has to be the app's — losing the newer file would be a worse loss than the one being undone. Nothing is deleted here: the refusal comes before the shell is reached, so a file sitting in the way is the whole of the setup.
#[test]
#[cfg(windows)]
fn a_name_taken_back_before_the_undo_stops_the_restore() {
    let folder = undo_dir("collide-test");
    let _ = fs::create_dir_all(&folder);
    let file = folder.join("collided.md");
    fs::write(&file, b"a different file entirely").expect("something takes the name");

    let error = restore_from_trash(&file, None).expect_err("the restore refuses");
    assert!(
        error.contains("something else is called"),
        "says why: {error}"
    );
    assert_eq!(
        fs::read(&file).expect("read it back"),
        b"a different file entirely",
        "and the file that took the name is untouched"
    );

    let _ = fs::remove_dir_all(&folder);
}

/// Nothing left in the bin under that name means the restore says so rather than reporting a success it did not have. Read off the exit code, so proving the wording does not need somebody's bin emptied first.
#[test]
#[cfg(windows)]
fn a_missing_item_says_the_file_has_left_the_bin() {
    use crate::platform::restore_outcome;

    let error = restore_outcome(Some(2)).expect_err("nothing to put back");
    assert!(
        error.contains("not in the Recycle Bin"),
        "says what is wrong: {error}"
    );
}

/// Every other way the restore can fail says one thing, because a reader can do nothing different about a move that never landed and a shell that never started.
#[test]
#[cfg(windows)]
fn any_other_failure_says_the_bin_would_not_give_it_back() {
    use crate::platform::restore_outcome;

    for code in [Some(1), Some(3), Some(-1), None] {
        let error = restore_outcome(code).expect_err("a failure");
        assert_eq!(
            error, "the Recycle Bin would not give the file back",
            "exit code {code:?}"
        );
    }
    assert!(
        restore_outcome(Some(0)).is_ok(),
        "and zero is the file back"
    );
}

/// A delete the app makes itself renamed the file into the home folder's Trash, and a rename cannot cross a filesystem — so a file on a plugged-in drive or a network share would not delete at all. It goes to the trash folder that volume carries instead, which is where macOS puts it and where the reader already looks.
#[test]
fn a_file_off_the_home_volume_is_trashed_on_the_volume_it_is_on() {
    use crate::platform::trash_folder_for_volume;

    let home = Path::new("/Users/me");

    // On the home volume, today's folder, unchanged.
    assert_eq!(
        trash_folder_for_volume(home, 16, 16, Path::new("/"), 501),
        PathBuf::from("/Users/me/.Trash")
    );

    // Off it, the volume's own folder, under the reader's user id — the two folders macOS itself defines.
    assert_eq!(
        trash_folder_for_volume(home, 16, 41, Path::new("/Volumes/BACKUP"), 501),
        PathBuf::from("/Volumes/BACKUP/.Trashes/501")
    );
}

/// A drive that will not take the file says so in its own name, never the system's wording for a cross-device link, which says nothing anybody can act on.
#[test]
fn a_drive_that_refuses_a_delete_is_named_in_the_message() {
    use crate::platform::drive_refused;

    let said = drive_refused(
        Path::new("/Volumes/BACKUP"),
        "Permission denied (os error 13)",
    );
    assert!(said.starts_with("BACKUP would not take the file"), "{said}");
    assert!(said.contains("Permission denied"), "{said}");

    // The startup volume is mounted at the root, which names nothing — the path stands in for it rather than leaving a blank.
    let root = drive_refused(Path::new("/"), "Read-only file system");
    assert!(root.starts_with("/ would not take the file"), "{root}");
}

/// The undo carries the path it means. Without it a message left on screen through a second delete would put the wrong file back, and nothing on this enum would notice.
#[test]
fn the_undo_names_the_file_it_means_to_put_back() {
    let sent = r#"{"command":"undoDelete","path":"/notes/a note.md"}"#;
    match serde_json::from_str::<IpcCommand>(sent) {
        Ok(IpcCommand::UndoDelete { path }) => {
            assert_eq!(path, PathBuf::from("/notes/a note.md"));
        }
        other => panic!("the undo did not arrive: {other:?}"),
    }
}
