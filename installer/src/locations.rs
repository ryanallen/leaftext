//! The two folders the install lands in.
//!
//! `%LOCALAPPDATA%\Programs\leaftext` is where per-user installers conventionally land, so Leaftext sits beside the other apps installed this way — and it is where the MSI puts it, which is what makes the two installers produce the same install. The scope is not negotiable: Windows will not let an unelevated process write to Program Files, so a per-machine install cannot replace itself without a UAC prompt every single time.

use std::path::PathBuf;

/// Where the app goes when nothing else is said. The folder a previous install remembered wins over this; `remembered_folder` is what asks.
pub fn default_install_folder() -> PathBuf {
    local_app_data().join("Programs").join("leaftext")
}

/// The Start Menu's Programs folder for this user. One entry goes straight into it rather than a subfolder, so there is nothing left behind to clean up.
pub fn start_menu_folder() -> PathBuf {
    roaming_app_data()
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
}

fn local_app_data() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join("AppData").join("Local"))
}

fn roaming_app_data() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join("AppData").join("Roaming"))
}

/// The user's own folder. Everything this installer writes is under it, which is the whole of what makes the install per-user.
pub fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\"))
}
