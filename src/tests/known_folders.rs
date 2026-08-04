//! The cloud folders that become vaults on their own.
//!
//! Every test here points the whole table at a temp folder. Aimed at the real machine they would pass by saying nothing on any machine without Dropbox installed, and `cargo test` prints nothing on a pass — so the check would look green and be empty.

use super::*;
use std::fs;

/// Roots under one temp folder: a home, the two Windows config folders, and no OneDrive environment.
fn roots(home: &Path) -> CloudRoots {
    CloudRoots {
        home: home.to_path_buf(),
        local_app_data: home.join("AppData/Local"),
        roaming_app_data: home.join("AppData/Roaming"),
        onedrive: Vec::new(),
    }
}

fn temp_home(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let home = std::env::temp_dir().join(format!("leaf-clouds-{tag}-{nanos}"));
    fs::create_dir_all(&home).expect("temp home");
    home
}

#[test]
fn a_client_that_is_not_installed_is_not_offered() {
    let home = temp_home("empty");
    let found = cloud_folders(&roots(&home));
    assert!(
        found.is_empty(),
        "nothing is installed under this home, so nothing may be offered: {found:?}"
    );
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn a_folder_at_the_default_place_is_found_by_name() {
    let home = temp_home("default");
    fs::create_dir_all(home.join("Dropbox")).expect("Dropbox folder");
    let found = cloud_folders(&roots(&home));
    assert_eq!(found.len(), 1, "one client is installed: {found:?}");
    assert_eq!(found[0].id, "dropbox");
    assert_eq!(found[0].name, "Dropbox");
    assert_eq!(found[0].path, home.join("Dropbox").to_string_lossy());
    assert!(!found[0].recorded, "the default place is not a record");
    let _ = fs::remove_dir_all(&home);
}

/// A moved Dropbox is the case the record exists for: the default folder is not there at all, and the only thing that knows where it went is `info.json`.
#[test]
fn a_moved_folder_is_found_where_the_client_recorded_it() {
    let home = temp_home("moved");
    let moved = home.join("Writing/Dropbox");
    fs::create_dir_all(&moved).expect("moved folder");
    let info = if cfg!(windows) {
        home.join("AppData/Local/Dropbox/info.json")
    } else {
        home.join(".dropbox/info.json")
    };
    fs::create_dir_all(info.parent().expect("info folder")).expect("info folder");
    let json = format!(
        "{{\"personal\":{{\"path\":{},\"host\":1,\"is_team\":false}}}}",
        serde_json::Value::String(moved.to_string_lossy().to_string())
    );
    fs::write(&info, json).expect("info.json");
    let found = cloud_folders(&roots(&home));
    assert_eq!(found.len(), 1, "one client is installed: {found:?}");
    assert_eq!(found[0].path, moved.to_string_lossy());
    assert!(found[0].recorded, "it came out of info.json");
    let _ = fs::remove_dir_all(&home);
}

/// A record naming a folder that has since been deleted must not be offered. This is the shape of the real failure on the machine this was built on: `%OneDrive%` is set, the folder it names was never created, and there is no account behind it.
#[test]
fn a_record_pointing_at_nothing_is_not_offered() {
    let home = temp_home("stale");
    let onedrive = home.join("OneDrive-Personal");
    let mut roots = roots(&home);
    roots.onedrive = vec![onedrive];
    let found = cloud_folders(&roots);
    assert!(
        found.is_empty(),
        "the recorded folder does not exist and neither does the default: {found:?}"
    );
    let _ = fs::remove_dir_all(&home);
}

/// A cloud folder becomes a vault by being found. Anything already registered is left alone, however it is spelled — Windows takes either slash and does not care about case, and a row added by the file dialog can carry a trailing one.
#[test]
fn a_cloud_folder_is_registered_once_however_the_path_is_spelled() {
    let home = temp_home("register");
    fs::create_dir_all(home.join("Dropbox")).expect("Dropbox folder");
    let found = cloud_folders(&roots(&home));
    assert_eq!(found.len(), 1);

    // Nothing registered yet: it is the one to add.
    let missing = cloud_folders_to_register(&found, &[]);
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].id, "dropbox");

    // Already a vault, spelled the other way: nothing to add, so nobody gets a second row for one folder.
    let same = found[0].path.replace('/', "\\").to_uppercase() + "\\";
    assert!(
        cloud_folders_to_register(&found, &[same]).is_empty(),
        "the same folder spelled differently is still the same folder"
    );

    // A different folder is not it.
    let elsewhere = home.join("Notes").to_string_lossy().to_string();
    assert_eq!(cloud_folders_to_register(&found, &[elsewhere]).len(), 1);
    let _ = fs::remove_dir_all(&home);
}

/// Saving anywhere under a cloud folder goes through that client, so the vault wears a cloud — not only the folder itself.
#[test]
fn a_vault_inside_a_cloud_folder_counts_as_being_in_it() {
    let home = temp_home("inside");
    fs::create_dir_all(home.join("Dropbox/Notes")).expect("a vault inside Dropbox");
    let found = cloud_folders(&roots(&home));
    let dropbox = &found[0];

    assert!(path_is_in_cloud_folder(&dropbox.path, dropbox));
    assert!(path_is_in_cloud_folder(
        &home.join("Dropbox/Notes").to_string_lossy(),
        dropbox
    ));
    // A folder whose name merely starts the same way is not inside it.
    assert!(!path_is_in_cloud_folder(
        &home.join("Dropbox-old").to_string_lossy(),
        dropbox
    ));
    assert!(!path_is_in_cloud_folder(
        &home.join("Notes").to_string_lossy(),
        dropbox
    ));
    let _ = fs::remove_dir_all(&home);
}
