//! Where the desktop sync clients keep their folders, so a cloud on this machine becomes a vault without anyone hunting for the path.
//!
//! Dropbox, OneDrive, iCloud Drive, Box, Nextcloud and Google Drive all put a real folder on the disk and keep it in step themselves. The app needs no account and no token for any of them: the vault is a plain folder vault and the client is the sync.
//!
//! Named locations only — a handful of `exists` calls, plus the one small file a client writes its own location into when it has been moved. Nothing walks a tree, and nothing is taken on trust: on the machine this was built for, `%OneDrive%` is set, names a folder that was never created, and has no account behind it.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// The folders the lookup is done under. Passed in rather than read inside each check so a test can point the whole table at a temp folder — otherwise every test below would pass by doing nothing on a machine with none of these clients installed.
#[derive(Debug, Clone)]
pub struct CloudRoots {
    /// The user's home folder: `C:\Users\name`, or `/Users/name`.
    pub home: PathBuf,
    /// `%LOCALAPPDATA%` on Windows. On macOS the clients use the home folder, so this is only read where Windows puts a config.
    pub local_app_data: PathBuf,
    /// `%APPDATA%` on Windows.
    pub roaming_app_data: PathBuf,
    /// Folders OneDrive names in the environment (`OneDrive`, `OneDriveConsumer`, `OneDriveCommercial`), in that order. OneDrive sets these itself, which is what makes them the record of a moved folder.
    pub onedrive: Vec<PathBuf>,
}

impl CloudRoots {
    /// Read the roots off the environment. `None` when there is no home folder to look under, which is the only thing here worth refusing over.
    pub fn from_environment() -> Option<Self> {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())?;
        let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let onedrive = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
            .into_iter()
            .filter_map(var)
            .filter(|path| !path.as_os_str().is_empty())
            .collect();
        Some(Self {
            local_app_data: var("LOCALAPPDATA").unwrap_or_else(|| home.join("AppData/Local")),
            roaming_app_data: var("APPDATA").unwrap_or_else(|| home.join("AppData/Roaming")),
            onedrive,
            home,
        })
    }
}

/// One cloud folder that is really on this machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFolder {
    /// Names the client. The page reads it to tell one row from another; the path a vault is registered at is always the one found here.
    pub id: &'static str,
    /// The name the client is known by, which is the only name a person is looking for.
    pub name: &'static str,
    pub path: String,
    /// Found where the client records its location rather than at the default. A moved folder is common, and this is what says the app read the record instead of guessing.
    pub recorded: bool,
}

/// Every client whose folder is on this machine, in a fixed order so two runs agree. A client that is not installed is simply absent.
pub fn cloud_folders(roots: &CloudRoots) -> Vec<CloudFolder> {
    let found = [
        ("dropbox", "Dropbox", dropbox(roots)),
        ("onedrive", "OneDrive", onedrive(roots)),
        ("icloud", "iCloud Drive", icloud(roots)),
        ("box", "Box", box_drive(roots)),
        ("nextcloud", "Nextcloud", nextcloud(roots)),
        ("gdrive", "Google Drive", google_drive(roots)),
    ];
    found
        .into_iter()
        .filter_map(|(id, name, hit)| {
            hit.map(|(path, recorded)| CloudFolder {
                id,
                name,
                path: path.to_string_lossy().to_string(),
                recorded,
            })
        })
        .collect()
}

/// Which of these folders is not a vault yet, given the folders that already are. There is nothing to press: a cloud on this machine becomes a vault by being found.
///
/// A vault the user removed is added again the next time the app looks. That is the cost of having nothing to press, and it is a folder they still have rather than a folder invented for them.
pub fn cloud_folders_to_register<'a>(
    folders: &'a [CloudFolder],
    vault_roots: &[String],
) -> Vec<&'a CloudFolder> {
    let existing: Vec<String> = vault_roots.iter().map(|root| same_path_key(root)).collect();
    folders
        .iter()
        .filter(|folder| !existing.contains(&same_path_key(&folder.path)))
        .collect()
}

/// One spelling of a path, for asking whether two name the same folder. Windows is case-insensitive and takes either slash, and a vault registered by the file dialog can carry a trailing one.
fn same_path_key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Whether `path` is that cloud folder or sits inside it — a vault under Dropbox saves through Dropbox just as the folder itself does.
pub fn path_is_in_cloud_folder(path: &str, folder: &CloudFolder) -> bool {
    let path = same_path_key(path);
    let folder = same_path_key(&folder.path);
    path == folder || path.starts_with(&format!("{folder}/"))
}

/// The first of `candidates` that is a directory, and whether it was the recorded one.
fn first_directory(recorded: Option<PathBuf>, default: PathBuf) -> Option<(PathBuf, bool)> {
    if let Some(path) = recorded.filter(|path| path.is_dir()) {
        return Some((path, true));
    }
    default.is_dir().then_some((default, false))
}

/// Dropbox writes its folder into `info.json` on both platforms, which is the whole reason a moved Dropbox is findable.
fn dropbox(roots: &CloudRoots) -> Option<(PathBuf, bool)> {
    let info = if cfg!(windows) {
        roots.local_app_data.join("Dropbox/info.json")
    } else {
        roots.home.join(".dropbox/info.json")
    };
    first_directory(dropbox_recorded(&info), roots.home.join("Dropbox"))
}

/// The personal folder from `info.json`, or the team one. Anything unreadable or unparsable is simply not a record.
fn dropbox_recorded(info: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(info).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    for account in ["personal", "business"] {
        if let Some(path) = json
            .get(account)
            .and_then(|entry| entry.get("path"))
            .and_then(serde_json::Value::as_str)
        {
            return Some(PathBuf::from(path));
        }
    }
    None
}

/// OneDrive sets its own environment variables, so those are the record. The folder is still checked: one machine had `%OneDrive%` naming a folder that was never created.
fn onedrive(roots: &CloudRoots) -> Option<(PathBuf, bool)> {
    let recorded = roots
        .onedrive
        .iter()
        .find(|path| path.is_dir())
        .map(PathBuf::from);
    first_directory(recorded, roots.home.join("OneDrive"))
}

/// iCloud Drive has one location per platform and no way to move it, so there is nothing to record.
fn icloud(roots: &CloudRoots) -> Option<(PathBuf, bool)> {
    let default = if cfg!(windows) {
        roots.home.join("iCloudDrive")
    } else {
        roots
            .home
            .join("Library/Mobile Documents/com~apple~CloudDocs")
    };
    first_directory(None, default)
}

/// Box Drive mounts through the file provider on current macOS, and puts a plain folder in the home folder on Windows.
fn box_drive(roots: &CloudRoots) -> Option<(PathBuf, bool)> {
    let provider = (!cfg!(windows)).then(|| roots.home.join("Library/CloudStorage/Box-Box"));
    first_directory(provider, roots.home.join("Box"))
}

/// The Nextcloud client keeps its sync folders in `nextcloud.cfg`, one `localPath` per folder. The first that is really there wins; the default is the fallback.
fn nextcloud(roots: &CloudRoots) -> Option<(PathBuf, bool)> {
    let config = if cfg!(windows) {
        roots.roaming_app_data.join("Nextcloud/nextcloud.cfg")
    } else {
        roots
            .home
            .join("Library/Preferences/Nextcloud/nextcloud.cfg")
    };
    first_directory(nextcloud_recorded(&config), roots.home.join("Nextcloud"))
}

fn nextcloud_recorded(config: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(config).ok()?;
    text.lines()
        .filter_map(|line| line.split_once('='))
        .find(|(key, _)| key.trim().eq_ignore_ascii_case("localPath"))
        .map(|(_, value)| PathBuf::from(value.trim()))
}

/// Google Drive for Desktop, on macOS only. It mounts as `GoogleDrive-<account>` under the file provider folder, so the account is read out of one directory listing rather than assumed.
///
/// Not found on Windows: there it mounts as a drive letter the user chooses, and no file the client writes records which one. Guessing a letter would hand somebody else's disk over as a vault.
fn google_drive(roots: &CloudRoots) -> Option<(PathBuf, bool)> {
    if cfg!(windows) {
        return None;
    }
    let mounts = roots.home.join("Library/CloudStorage");
    let mut entries: Vec<PathBuf> = fs::read_dir(&mounts)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("GoogleDrive-"))
                && path.is_dir()
        })
        .collect();
    // One account per machine is the common case; sorting keeps two runs agreeing when there are two.
    entries.sort();
    entries.into_iter().next().map(|path| (path, true))
}
