//! Staged updates: take delivery of a new installer, verify it, and keep it on disk until the user asks to restart into it.
//!
//! The page finds the release; `platform::download_to` fetches it. That split is forced: GitHub serves release assets from a host that sends no `Access-Control-Allow-Origin`, so a `fetch` for one fails in any web view before a byte arrives. Both platforms ship an HTTP client using the OS certificate store, so the native path costs no dependency.
//!
//! Rust writing the file also matters on macOS: what a browser engine downloads carries `com.apple.quarantine`, which Gatekeeper refuses to launch unless the bundle is notarized. A file this process writes carries no such attribute.
//!
//! A release publishes one file per platform and no checksum beside it: a digest served from the same host proves nothing the advertised byte count and TLS do not, and it put three unexplainable files on every release page. The digest of what landed is still recorded, so the applier can re-hash the installer before running it — that catches the file changing while it waits in a user-writable folder, which is a threat this side can actually see.
//!
//! Nothing here installs on its own. Until the artifacts are code signed no amount of hashing makes them trustworthy, so every install is a button the user pressed.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Check at most this often. Asking GitHub on every launch is a lot of spend against an unauthenticated 60-requests-per-hour limit, for an answer that changes at most daily.
pub const UPDATE_CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;

/// Refuse a download larger than this. The installers run about 6 MB; the cap exists so a wrong or hostile URL cannot fill the user's disk.
pub const MAX_UPDATE_BYTES: u64 = 128 * 1024 * 1024;

/// Seconds since the Unix epoch, or 0 if the clock is before it.
pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Whether enough time has passed since `last_checked` to ask GitHub again. A clock that moved backwards (or a corrupt settings value in the future) reads as due rather than blocking checks forever.
pub fn update_check_is_due(last_checked: u64, now: u64) -> bool {
    now < last_checked || now.saturating_sub(last_checked) >= UPDATE_CHECK_INTERVAL_SECS
}

/// Compare dotted numeric versions, ignoring a leading `v`. Mirrors the frontend's comparison so both halves agree on what "newer" means.
pub fn is_newer_version(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        value
            .trim()
            .trim_start_matches(['v', 'V'])
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let candidate = parse(candidate);
    let current = parse(current);
    for index in 0..candidate.len().max(current.len()) {
        let left = candidate.get(index).copied().unwrap_or(0);
        let right = current.get(index).copied().unwrap_or(0);
        if left != right {
            return left > right;
        }
    }
    false
}

/// Whether an installer may be fetched from this URL.
///
/// Untrusted input aimed at a native HTTP client: the URL comes off the network by way of the page, and no content policy stands behind it here. HTTPS only, and only hosts GitHub serves releases from.
pub fn update_url_is_allowed(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    // The asset URL starts on github.com and redirects to storage under githubusercontent.com; the leading dot is what stops a lookalike host ending in "githubusercontent.com" from matching.
    parsed.host_str().is_some_and(|host| {
        host == "github.com"
            || host == "githubusercontent.com"
            || host.ends_with(".githubusercontent.com")
    })
}

/// Windows publishes two installers, both of which a person can run. A machine whose policy blocks Windows Installer packages refuses the MSI whoever signed it, so the EXE is the way around that — and each installed copy keeps updating through whichever one put it there.
pub const WINDOWS_MSI_SUFFIX: &str = "-windows-x86_64.msi";
pub const WINDOWS_EXE_SUFFIX: &str = "-windows-x86_64.exe";

/// macOS publishes one: the disk image a person double-clicks, which is why `install` in `platform.rs` mounts it.
pub const MACOS_SUFFIX: &str = "-macos-universal.dmg";

/// Which Windows installer a copy updates through, from the marker the EXE installer writes beside the values the MSI already writes.
///
/// Absent means the MSI, because that is what every copy on disk today looks like — so nothing had to be written for the copies that are already out there. Reading the marker is `platform.rs`'s job: this library compiles for a browser and must not reach the machine.
pub fn windows_asset_suffix(installed_by: Option<&str>) -> &'static str {
    match installed_by {
        Some(marker) if marker.trim().eq_ignore_ascii_case("exe") => WINDOWS_EXE_SUFFIX,
        _ => WINDOWS_MSI_SUFFIX,
    }
}

/// The release asset this build can install, as a file-name suffix: the same file a person downloads by hand.
///
/// Windows is not here. Which of its two files a copy takes is a registry read, so `platform.rs` answers it and the binary hands the answer to the page.
pub fn platform_asset_suffix() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        MACOS_SUFFIX
    }
    // A browser core has no installer to offer, which the page already reads as notify-only.
    #[cfg(not(target_os = "macos"))]
    {
        ""
    }
}

/// Root of the staging area, beside the vault registry in the app data folder.
pub fn updates_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("updates")
}

/// One directory per version, so a partial download of 0.1.362 can never be confused for a finished one of 0.1.361.
pub fn staging_dir(data_dir: &Path, version: &str) -> PathBuf {
    updates_dir(data_dir).join(sanitize_version(version))
}

/// Version strings reach us from a network response and are used as a path segment, so strip anything that is not plainly a version character. Without this a `tag_name` of `../..` would escape the staging area.
fn sanitize_version(version: &str) -> String {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
        .collect()
}

/// Asset names are used as file names for the same reason; keep them to a single, ordinary path component.
fn sanitize_asset_name(asset: &str) -> Option<String> {
    let name = asset.trim();
    if name.is_empty()
        || name.len() > 200
        || name.contains('/')
        || name.contains('\\')
        || name.starts_with('.')
    {
        return None;
    }
    if !name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
    {
        return None;
    }
    Some(name.to_string())
}

/// A verified installer waiting on disk. Written beside the installer as `manifest.json` so a later launch can find and trust it without repeating the download.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedUpdate {
    /// Version this installs, without a leading `v`.
    pub version: String,
    /// Installer file name, inside the same directory as the manifest.
    pub asset: String,
    /// Hex blake3 digest of the installer as it was written, for the applier to re-check before running it.
    pub blake3: String,
    /// Size in bytes, as written.
    pub size: u64,
    /// When staging finished, Unix seconds.
    pub staged_at: u64,
}

impl StagedUpdate {
    /// Full path to the installer.
    pub fn installer_path(&self, data_dir: &Path) -> PathBuf {
        staging_dir(data_dir, &self.version).join(&self.asset)
    }
}

/// Read back a staged update, returning `None` unless the manifest parses *and* the installer it names is still on disk at the recorded size. A half-deleted staging directory reads as nothing staged.
pub fn read_staged(data_dir: &Path, version: &str) -> Option<StagedUpdate> {
    let directory = staging_dir(data_dir, version);
    let manifest = fs::read_to_string(directory.join("manifest.json")).ok()?;
    let staged: StagedUpdate = serde_json::from_str(&manifest).ok()?;
    let installer = directory.join(&staged.asset);
    let metadata = fs::metadata(&installer).ok()?;
    (metadata.len() == staged.size).then_some(staged)
}

/// Delete every staged version except `keep`. A user who skips five releases should not be carrying five installers around.
///
/// Directories only: the applier's outcome record sits beside them and has to survive until the next launch reads it.
pub fn prune_staged(data_dir: &Path, keep: Option<&str>) {
    let keep = keep.map(sanitize_version);
    let Ok(entries) = fs::read_dir(updates_dir(data_dir)) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if keep.as_deref() == Some(name.as_ref()) {
            continue;
        }
        let _ = fs::remove_dir_all(entry.path());
    }
}

/// How the last install attempt went, written by the detached applier and read once by the next launch.
///
/// The applier is windowless and detached: its stderr goes nowhere, and the app that could have shown a message has already exited. Without this file, a failed install looks exactly like one that never happened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplyOutcome {
    /// Version the applier was installing.
    pub version: String,
    /// Whether the install reported success.
    pub ok: bool,
    /// Why it failed, when it did.
    #[serde(default)]
    pub message: String,
    /// When the attempt finished, Unix seconds.
    pub finished_at: u64,
}

/// Where the applier leaves its verdict: beside the staging folders, not inside one, since the folder it was installing from is the first thing pruned.
fn apply_outcome_path(updates_dir: &Path) -> PathBuf {
    updates_dir.join("last-apply.json")
}

/// Record how an install attempt ended. `staging_dir` is the folder the applier was handed; the record goes in its parent, which is the updates root.
pub fn record_apply_outcome(staging_dir: &Path, version: &str, error: Option<&str>) {
    let root = staging_dir.parent().unwrap_or(staging_dir);
    let outcome = ApplyOutcome {
        version: version.to_string(),
        ok: error.is_none(),
        message: error.unwrap_or_default().to_string(),
        finished_at: now_unix(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&outcome) {
        let _ = fs::create_dir_all(root);
        let _ = fs::write(apply_outcome_path(root), json);
    }
}

/// Read and delete the applier's verdict. Deleted on read: it describes one attempt, and reporting it twice would be a lie the second time.
pub fn take_apply_outcome(data_dir: &Path) -> Option<ApplyOutcome> {
    let path = apply_outcome_path(&updates_dir(data_dir));
    let json = fs::read_to_string(&path).ok();
    let _ = fs::remove_file(&path);
    serde_json::from_str(&json?).ok()
}

/// An in-progress download: bytes land in a `.part` file and are hashed as they arrive, so the finished file is never the one that was being written to.
pub struct UpdateDownload {
    version: String,
    asset: String,
    expected_size: u64,
    written: u64,
    part_path: PathBuf,
    final_path: PathBuf,
    manifest_path: PathBuf,
    file: File,
    hasher: blake3::Hasher,
}

impl UpdateDownload {
    /// Open a staging directory for `version` and start a fresh `.part` file. Any earlier attempt at the same version is discarded first, so a torn download never contributes bytes to the next one.
    pub fn begin(
        data_dir: &Path,
        version: &str,
        asset: &str,
        expected_size: u64,
    ) -> Result<Self, String> {
        let version = sanitize_version(version);
        if version.is_empty() {
            return Err("the release did not name a usable version".to_string());
        }
        let asset = sanitize_asset_name(asset).ok_or("the release asset has an unusable name")?;
        if expected_size == 0 || expected_size > MAX_UPDATE_BYTES {
            return Err(format!("refusing a {expected_size}-byte download"));
        }

        let directory = staging_dir(data_dir, &version);
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory)
            .map_err(|error| format!("could not create the staging folder: {error}"))?;

        let part_path = directory.join(format!("{asset}.part"));
        let file = File::create(&part_path)
            .map_err(|error| format!("could not open the download file: {error}"))?;

        Ok(Self {
            version,
            expected_size,
            written: 0,
            final_path: directory.join(&asset),
            manifest_path: directory.join("manifest.json"),
            asset,
            part_path,
            file,
            hasher: blake3::Hasher::new(),
        })
    }

    /// Append one chunk, refusing to grow past the size the release advertised.
    pub fn write_chunk(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.written = self.written.saturating_add(bytes.len() as u64);
        if self.written > self.expected_size {
            return Err("the download is larger than the release said it would be".to_string());
        }
        self.hasher.update(bytes);
        self.file
            .write_all(bytes)
            .map_err(|error| format!("could not write the download: {error}"))
    }

    /// Fraction complete, 0-100, for the button label.
    pub fn percent(&self) -> u8 {
        if self.expected_size == 0 {
            return 0;
        }
        ((self.written.min(self.expected_size) * 100) / self.expected_size) as u8
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    /// Publish: the `.part` file is only renamed into place once the full length arrived, so anything that finds the final name is a whole download. The digest of what landed goes in the manifest for the applier to re-check.
    pub fn finish(self) -> Result<StagedUpdate, String> {
        // Take the struct apart so the file handle can be closed before the rename — Windows will not rename a file that is still open.
        let Self {
            version,
            asset,
            expected_size,
            written,
            part_path,
            final_path,
            manifest_path,
            mut file,
            hasher,
        } = self;
        let flushed = file.flush();
        drop(file);
        flushed.map_err(|error| format!("could not flush the download: {error}"))?;

        if written != expected_size {
            let _ = fs::remove_file(&part_path);
            return Err(format!(
                "the download stopped early ({written} of {expected_size} bytes)"
            ));
        }

        let digest = hasher.finalize().to_hex().to_string();

        fs::rename(&part_path, &final_path)
            .map_err(|error| format!("could not finalize the download: {error}"))?;

        let staged = StagedUpdate {
            version,
            asset,
            blake3: digest,
            size: written,
            staged_at: now_unix(),
        };
        let manifest = serde_json::to_string_pretty(&staged)
            .map_err(|error| format!("could not describe the staged update: {error}"))?;
        fs::write(&manifest_path, manifest)
            .map_err(|error| format!("could not record the staged update: {error}"))?;
        Ok(staged)
    }

    /// Throw away a failed or canceled download.
    pub fn discard(&self) {
        let _ = fs::remove_file(&self.part_path);
    }
}

/// Hash a file that is already on disk, to re-check a staged installer before handing it to the installer program.
pub fn hash_file(path: &Path) -> io::Result<String> {
    let mut hasher = blake3::Hasher::new();
    let mut file = File::open(path)?;
    io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().to_hex().to_string())
}
