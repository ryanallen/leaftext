//! Checking for, staging, and applying an update.

use super::*;

/// Push a terminal update state to the page. Progress is reported by the page
/// itself, so the host only ever sends `staged` or `failed`.
pub(crate) fn report_update_state(
    webview: Option<&WebView>,
    status: &str,
    version: &str,
    message: Option<&str>,
) {
    run_page_script(
        webview,
        &update_state_script(status, version, message),
        "Failed to report update state",
    );
}

/// Fetch and stage an installer, then report how it went. Runs on its own
/// thread: this is seconds to minutes of network I/O, and the event loop has a
/// window to keep painting. The page cannot fetch it — `updater.rs` says why.
pub(crate) fn run_update_download(
    proxy: EventLoopProxy<UserEvent>,
    version: String,
    asset: String,
    size: u64,
    url: String,
) -> UserEvent {
    match stage_update_download(&proxy, &version, &asset, size, &url) {
        Ok(staged) => UserEvent::UpdateDownloadStaged { version: staged },
        Err(message) => UserEvent::UpdateDownloadFailed { version, message },
    }
}

/// The download proper, returning the version that was staged. A partial file is
/// discarded on the way out, so a failure never leaves bytes that a later launch
/// could mistake for a finished download.
pub(crate) fn stage_update_download(
    proxy: &EventLoopProxy<UserEvent>,
    version: &str,
    asset: &str,
    size: u64,
    url: &str,
) -> Result<String, String> {
    if !leaftext::update_url_is_allowed(url) {
        return Err("the release points its download somewhere unexpected".to_string());
    }
    let data_dir =
        app_data_dir().ok_or_else(|| "there is no app data folder to download into".to_string())?;
    let mut download = UpdateDownload::begin(&data_dir, version, asset, size)?;

    // Repaint on whole-percent changes only: the transfer hands back dozens of
    // chunks per percent, and each one crosses to the web view.
    let mut painted = 0;
    let streamed = platform::download_to(url, &mut |bytes| {
        download.write_chunk(bytes)?;
        let percent = download.percent();
        if percent != painted {
            painted = percent;
            let _ = proxy.send_event(UserEvent::UpdateDownloadProgress {
                version: version.to_string(),
                percent,
            });
        }
        Ok(())
    });
    if let Err(error) = streamed {
        download.discard();
        return Err(error);
    }

    download.finish().map(|staged| staged.version)
}

/// Reconcile the staged-update bookkeeping at launch.
///
/// If the staged version is the version now running, the install worked and the
/// record is stale — clear it. Then delete every staged folder except one still
/// genuinely pending, which also cleans up the helper copy the last update left
/// behind. Returns true when settings changed and need saving.
pub(crate) fn reconcile_staged_update(settings: &mut Settings) -> bool {
    let Some(data_dir) = app_data_dir() else {
        return false;
    };
    let running = env!("CARGO_PKG_VERSION");
    let mut changed = false;

    if !settings.update_staged_version.is_empty()
        && !leaftext::is_newer_version(&settings.update_staged_version, running)
    {
        settings.update_staged_version.clear();
        changed = true;
    }

    // A record pointing at a folder that is gone is worse than no record: the
    // button would offer a restart that cannot happen.
    if !settings.update_staged_version.is_empty()
        && leaftext::read_staged(&data_dir, &settings.update_staged_version).is_none()
    {
        settings.update_staged_version.clear();
        changed = true;
    }

    // The install worked, so the one-attempt guard has nothing left to guard.
    if settings.update_staged_version.is_empty() && !settings.update_auto_applied.is_empty() {
        settings.update_auto_applied.clear();
        changed = true;
    }

    let keep = (!settings.update_staged_version.is_empty())
        .then_some(settings.update_staged_version.as_str());
    leaftext::prune_staged(&data_dir, keep);
    changed
}

/// Whether a launch should install the staged update by itself. Split out from the
/// work so the one-attempt guard is testable.
pub(crate) fn should_auto_apply(settings: &Settings, staged_present: bool) -> bool {
    staged_present
        && !settings.update_staged_version.is_empty()
        && settings.update_auto_applied != settings.update_staged_version
}

/// Install a staged update before opening a window: what makes updating automatic
/// rather than merely offered. Returns true when the applier was launched and this
/// process must exit without building any UI.
///
/// The attempt is recorded *before* the helper starts, so an installer that fails
/// silently is tried exactly once and then left to the button in Settings.
pub(crate) fn auto_apply_staged_update(
    settings: &mut Settings,
    settings_path: Option<&PathBuf>,
) -> bool {
    let Some(data_dir) = app_data_dir() else {
        return false;
    };
    let staged_version = settings.update_staged_version.clone();
    let staged = leaftext::read_staged(&data_dir, &staged_version);
    if !should_auto_apply(settings, staged.is_some()) {
        return false;
    }
    let staged = staged.expect("should_auto_apply requires a staged installer");

    settings.update_auto_applied = staged_version;
    persist_settings(settings, settings_path);

    let directory = leaftext::staging_dir(&data_dir, &staged.version);
    match platform::spawn_update_helper(&directory) {
        Ok(()) => true,
        Err(error) => {
            eprintln!(
                "Could not start the installer for v{}: {error}",
                staged.version
            );
            false
        }
    }
}

/// Write the UI toggles to disk, logging but not propagating I/O errors.
pub(crate) fn persist_settings(settings: &Settings, settings_path: Option<&PathBuf>) {
    if let Some(path) = settings_path {
        if let Err(error) = save_settings(path, settings) {
            eprintln!("Failed to save settings to {}: {error}", path.display());
        }
    }
}
