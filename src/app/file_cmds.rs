//! What the page's file and favorite commands do, one function each — open, new, paste, reveal, copy, favorite, rename, delete, put back, properties.
//!
//! Beside `fileops.rs` rather than inside it: that file holds the work these call — the picker, the transfer, the trash, the clipboard — and is long enough already. Each function here reads the event's values, calls that work, and tells the page how it went.
//!
//! Every failure is said twice on purpose. The line to the journal names the file and the operating system's own words, for whoever reads the log; the growl to the page says what the reader can do about it, in the reader's words.

use super::*;

/// The file picker, and whatever comes back opened in the tab in front.
pub(crate) fn open(reader: &mut Reader) {
    if let Some(path) = pick_document_file() {
        reader.workspace.open_path(path);
        reader.render(ScrollIntent::Reset);
    }
}

/// An untitled document, already unlocked. The unlock goes out before the render, so the first paint already carries the editors — there is nothing to click before typing.
pub(crate) fn new_document(reader: &mut Reader) {
    reader.workspace.open_untitled();
    run_page_script(
        reader.page(),
        &unlock_reading_script(),
        "Failed to unlock the new document",
    );
    reader.render(ScrollIntent::Reset);
}

/// A row of the recents list. The page opening a file is the same act as a forwarded open, so it goes round the same way.
pub(crate) fn open_recent(proxy: &EventLoopProxy<UserEvent>, path: PathBuf) {
    let _ = proxy.send_event(UserEvent::OpenPath(path));
}

/// A file dropped or pasted into a folder of the library pane, moved when it was cut and copied when it was not.
pub(crate) fn paste(reader: &Reader, path: &Path, into_folder: &Path, cut: bool) {
    match transfer_into_folder(path, into_folder, cut) {
        Ok(_) => refresh_library_folder(reader.page()),
        Err(error) => {
            let verb = if cut { "move" } else { "copy" };
            eprintln!(
                "Failed to {verb} {} into {}: {error}",
                path.display(),
                into_folder.display()
            );
            report_file_action_failure(reader.page(), &error.to_string());
        }
    }
}

/// The file shown where it sits, in whatever the platform calls its file window.
pub(crate) fn reveal(reader: &Reader, path: &Path) {
    if let Err(error) = reveal_in_file_manager(path) {
        eprintln!(
            "Failed to reveal {} in the file manager: {error}",
            path.display()
        );
        // Explorer here and Finder there, so the sentence names the window rather than either of them. A reveal that says nothing reads as a slow machine, and the reader waits.
        report_file_action_failure(reader.page(), "the file manager window could not be opened");
    }
}

/// The file on the clipboard, ready to paste into another program.
///
/// Off the loop: the helper writes the real clipboard, which another program can be holding open, so the wait for its answer happens elsewhere and the window never stops for it.
pub(crate) fn copy_file(proxy: &EventLoopProxy<UserEvent>, path: PathBuf, cut: bool) {
    off_loop(proxy, move || UserEvent::FileClipboardDone {
        cut,
        error: copy_file_to_clipboard(&path, cut).err().map(|error| {
            format!(
                "Failed to copy {} to the clipboard: {error}",
                path.display()
            )
        }),
    });
}

/// The heart on a tab, and the right-click item for everything not open.
///
/// Which vault holds it is the registry's answer, not the pane's: something opened from outside every vault belongs to none.
pub(crate) fn toggle_favorite(
    reader: &mut Reader,
    vault_state: &VaultState,
    path: PathBuf,
    kind: FavoriteKind,
) {
    let vault_id = vault_state
        .conn
        .as_ref()
        .and_then(|conn| vault_containing(conn, &path))
        .map(|vault| vault.id);
    reader.toggle_favorite(path, kind, vault_id);
}

/// Which favorites are no longer on the disk, marked on the rows already drawn.
///
/// A metadata read per favorite, and only while the start screen is up: the list is short and the user marked every path in it, so this is not a crawl. Never stored, because a stored answer is wrong the moment a file moves with the app shut.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct MissingFavorites {
    pub paths: Vec<String>,
    pub vaults: Vec<i64>,
}

pub(crate) fn missing_favorites(
    favorites: &Favorites,
    vaults: impl IntoIterator<Item = (i64, String)>,
) -> MissingFavorites {
    let paths = favorites
        .entries
        .iter()
        .filter(|one| !one.path.exists())
        .map(|one| one.path.display().to_string())
        .collect();
    let vaults = vaults
        .into_iter()
        .filter(|(_, root)| !Path::new(root).is_dir())
        .map(|(id, _)| id)
        .collect();
    MissingFavorites { paths, vaults }
}

pub(crate) fn check_favorites(reader: &Reader, vault_state: &VaultState) {
    // A vault whose own folder has gone is one fact, not one per row inside it: repointing a file inside a folder that is not there is not the fix.
    let vaults = vault_state
        .conn
        .as_ref()
        .and_then(|conn| list_vaults(conn).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|vault| (vault.id, vault.root_path));
    let missing = missing_favorites(&reader.favorites, vaults);
    run_page_script(
        reader.page(),
        &favorites_missing_script(&missing.paths, &missing.vaults),
        "Failed to mark the favorites that have gone",
    );
}

/// A favorite row pointed at the file it has become: the picker Open opens, and that entry repointed in place.
pub(crate) fn repoint_favorite(reader: &mut Reader, vault_state: &VaultState, path: &Path) {
    if let Some(chosen) = pick_document_file() {
        let vault_id = vault_state
            .conn
            .as_ref()
            .and_then(|conn| vault_containing(conn, &chosen))
            .map(|vault| vault.id);
        reader.repoint_favorite(path, &chosen, vault_id);
    }
}

/// A favorite dragged to sit before another one, or to the end when there is none.
pub(crate) fn move_favorite(reader: &mut Reader, path: &Path, before: Option<&Path>) {
    reader.move_favorite(path, before);
}

/// The file's own path on the clipboard as text.
pub(crate) fn copy_path(reader: &Reader, path: &Path) {
    if let Err(error) = copy_path_to_clipboard(path) {
        eprintln!(
            "Failed to copy the path {} to the clipboard: {error}",
            path.display()
        );
        // A copy shows nothing of its own, so its failure is otherwise met at a paste in another app.
        report_file_action_failure(reader.page(), "the path could not be copied — try again");
    }
}

/// The file renamed on disk, with a tab following it where one was showing it.
pub(crate) fn rename(reader: &mut Reader, path: &Path, new_name: &str) {
    match rename_file(path, new_name) {
        Ok(renamed) => {
            // The watcher re-aims itself at the active document every turn and needs nothing here.
            if let Some(intent) = followed_rename_intent(&mut reader.workspace, path, &renamed) {
                reader.record_recent(renamed);
                reader.render(intent);
            }
            refresh_library_folder(reader.page());
        }
        Err(error) => {
            eprintln!("Failed to rename {}: {error}", path.display());
            report_file_action_failure(reader.page(), &error.to_string());
        }
    }
}

/// The file to the trash, and the offer to put it back.
pub(crate) fn delete(
    reader: &Reader,
    last_delete: &mut Option<(PathBuf, Option<PathBuf>)>,
    path: PathBuf,
) {
    match delete_to_trash(&path) {
        Ok(landed) => {
            // Where it went, kept only until the next delete or the undo that spends it. Windows answers `None` and needs nothing more than the original path.
            *last_delete = Some((path.clone(), landed));
            refresh_library_folder(reader.page());
            report_file_deleted(reader.page(), &path);
        }
        Err(error) => {
            eprintln!("Failed to move {} to the trash: {error}", path.display());
            report_file_action_failure(reader.page(), &error);
        }
    }
}

/// The last delete undone — and only the delete the record is actually about: the page's offer expires with its message, and the two must not be able to drift apart.
pub(crate) fn delete_to_restore(
    last_delete: &mut Option<(PathBuf, Option<PathBuf>)>,
    path: &Path,
) -> Option<(PathBuf, Option<PathBuf>)> {
    match last_delete.take() {
        Some((original, landed)) if original == path => Some((original, landed)),
        _ => None,
    }
}

pub(crate) fn undo_delete(
    reader: &Reader,
    last_delete: &mut Option<(PathBuf, Option<PathBuf>)>,
    path: &Path,
) {
    // Not ours to undo, and putting the record back would leave a spent offer live.
    let restoring = delete_to_restore(last_delete, path);
    match restoring {
        Some((original, landed)) => match restore_from_trash(&original, landed.as_deref()) {
            Ok(()) => refresh_library_folder(reader.page()),
            Err(error) => {
                eprintln!("Failed to bring {} back: {error}", original.display());
                report_file_action_failure(reader.page(), &error);
            }
        },
        None => report_file_action_failure(reader.page(), "there is nothing left to put back"),
    }
}

/// The platform's own information window for the file.
pub(crate) fn properties(reader: &Reader, path: &Path) {
    if let Err(error) = show_properties(path) {
        eprintln!("Failed to show properties for {}: {error}", path.display());
        // The mechanism is a shell verb here and Finder there; neither is what the reader pressed.
        report_file_action_failure(reader.page(), "the information window could not be opened");
    }
}

/// The file a picture in a document is drawn from, resolved back off the address the page sent. A picture served from anywhere but this disk answers nothing, which is what leaves a remote one with no file rows at all.
///
/// Split from the document in front so the resolution can be read on its own: the page holds no path for a picture, so what the right-click menu sends is an address, and which folder it is relative to is the open document's answer.
pub(crate) fn picture_file_for(document: Option<&Path>, source: &str) -> Option<PathBuf> {
    let folder = local_image_source_dir(document?)?;
    local_image_protocol_path(source, &folder)
}

/// The same, against the document in front. The menu's three picture rows and the picture export all ask this one question of one address, so there is one answer to it.
pub(crate) fn picture_source_path(reader: &Reader, source: &str) -> Option<PathBuf> {
    picture_file_for(reader.workspace.active_path(), source)
}

/// The picture's own file shown where it sits, rather than the note holding it.
pub(crate) fn reveal_picture(reader: &Reader, source: &str) {
    match picture_source_path(reader, source) {
        Some(file) => reveal(reader, &file),
        None => report_missing_picture_file(reader),
    }
}

/// The picture's own path on the clipboard as text, rather than the note's.
pub(crate) fn copy_picture_path(reader: &Reader, source: &str) {
    match picture_source_path(reader, source) {
        Some(file) => copy_path(reader, &file),
        None => report_missing_picture_file(reader),
    }
}

/// The platform's own information window for the picture, rather than for the note holding it.
pub(crate) fn picture_properties(reader: &Reader, source: &str) {
    match picture_source_path(reader, source) {
        Some(file) => properties(reader, &file),
        None => report_missing_picture_file(reader),
    }
}

/// What the three picture rows say when the address names no file here. The page draws them only over a picture on this disk, so reaching this means the document moved out from under an open menu — and silence there reads as a row that does nothing.
fn report_missing_picture_file(reader: &Reader) {
    report_file_action_failure(reader.page(), "that picture is not a file on this machine");
}
