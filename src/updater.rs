//! Staged updates: take delivery of a new installer, verify it, and keep it on
//! disk until the user asks to restart into it.
//!
//! The download happens in the web view, which already has an OS-maintained TLS
//! stack — linking a second one into the binary to fetch a file a month is not a
//! trade worth making. The page streams bytes here in chunks; this module owns
//! what matters: where the file lands, what it hashes to, and whether it may be
//! installed.
//!
//! Rust writing the file also matters on macOS: what a browser engine downloads
//! carries `com.apple.quarantine`, which Gatekeeper refuses to launch unless the
//! bundle is notarized. A file this process writes carries no such attribute.
//!
//! Nothing here installs on its own. The checksum beside a release comes from
//! the same place as the release, so it proves the download arrived intact, not
//! that it is trustworthy. Until the artifacts are code signed, every install is
//! a button the user pressed.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Check at most this often. The app used to ask GitHub on every single launch,
/// which against an unauthenticated 60-requests-per-hour limit is a lot of
/// spend for an answer that changes at most daily.
pub const UPDATE_CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;

/// Refuse a download larger than this. The installers run about 6 MB; the cap
/// exists so a wrong or hostile URL cannot fill the user's disk.
pub const MAX_UPDATE_BYTES: u64 = 128 * 1024 * 1024;

/// Seconds since the Unix epoch, or 0 if the clock is before it.
pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Whether enough time has passed since `last_checked` to ask GitHub again.
/// A clock that moved backwards (or a corrupt settings value in the future)
/// reads as due rather than blocking checks forever.
pub fn update_check_is_due(last_checked: u64, now: u64) -> bool {
    now < last_checked || now.saturating_sub(last_checked) >= UPDATE_CHECK_INTERVAL_SECS
}

/// Compare dotted numeric versions, ignoring a leading `v`. Mirrors the
/// frontend's comparison so both halves agree on what "newer" means.
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

/// The release asset this build can install, as a file-name suffix. Windows
/// takes the MSI; macOS takes a zipped app bundle rather than the DMG, because
/// mounting and copying out of a disk image is fragile to automate.
pub fn platform_asset_suffix() -> &'static str {
    #[cfg(windows)]
    {
        "-windows-x86_64.msi"
    }
    #[cfg(target_os = "macos")]
    {
        "-macos-universal.app.zip"
    }
}

/// Checksum files are published as `<asset>.blake3`, holding the hex digest.
pub const CHECKSUM_EXTENSION: &str = "blake3";

/// Root of the staging area, beside the search index in the app data folder.
pub fn updates_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("updates")
}

/// One directory per version, so a partial download of 0.1.362 can never be
/// confused for a finished one of 0.1.361.
pub fn staging_dir(data_dir: &Path, version: &str) -> PathBuf {
    updates_dir(data_dir).join(sanitize_version(version))
}

/// Version strings reach us from a network response and are used as a path
/// segment, so strip anything that is not plainly a version character. Without
/// this a `tag_name` of `../..` would escape the staging area.
fn sanitize_version(version: &str) -> String {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
        .collect()
}

/// Asset names are used as file names for the same reason; keep them to a
/// single, ordinary path component.
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

/// A verified installer waiting on disk. Written beside the installer as
/// `manifest.json` so a later launch can find and trust it without repeating
/// the download.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedUpdate {
    /// Version this installs, without a leading `v`.
    pub version: String,
    /// Installer file name, inside the same directory as the manifest.
    pub asset: String,
    /// Hex blake3 digest the installer was verified against.
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

/// Read back a staged update, returning `None` unless the manifest parses *and*
/// the installer it names is still on disk at the recorded size. A half-deleted
/// staging directory reads as nothing staged.
pub fn read_staged(data_dir: &Path, version: &str) -> Option<StagedUpdate> {
    let directory = staging_dir(data_dir, version);
    let manifest = fs::read_to_string(directory.join("manifest.json")).ok()?;
    let staged: StagedUpdate = serde_json::from_str(&manifest).ok()?;
    let installer = directory.join(&staged.asset);
    let metadata = fs::metadata(&installer).ok()?;
    (metadata.len() == staged.size).then_some(staged)
}

/// Delete every staged version except `keep`. A user who skips five releases
/// should not be carrying five installers around.
pub fn prune_staged(data_dir: &Path, keep: Option<&str>) {
    let keep = keep.map(sanitize_version);
    let Ok(entries) = fs::read_dir(updates_dir(data_dir)) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if keep.as_deref() == Some(name.as_ref()) {
            continue;
        }
        let _ = fs::remove_dir_all(entry.path());
    }
}

/// An in-progress download: bytes land in a `.part` file and are hashed as they
/// arrive, so the finished file is never the one that was being written to.
pub struct UpdateDownload {
    version: String,
    asset: String,
    expected_blake3: String,
    expected_size: u64,
    written: u64,
    part_path: PathBuf,
    final_path: PathBuf,
    manifest_path: PathBuf,
    file: File,
    hasher: blake3::Hasher,
}

impl UpdateDownload {
    /// Open a staging directory for `version` and start a fresh `.part` file.
    /// Any earlier attempt at the same version is discarded first, so a torn
    /// download never contributes bytes to the next one.
    pub fn begin(
        data_dir: &Path,
        version: &str,
        asset: &str,
        expected_blake3: &str,
        expected_size: u64,
    ) -> Result<Self, String> {
        let version = sanitize_version(version);
        if version.is_empty() {
            return Err("the release did not name a usable version".to_string());
        }
        let asset = sanitize_asset_name(asset).ok_or("the release asset has an unusable name")?;
        let expected_blake3 = normalize_digest(expected_blake3)
            .ok_or("the published checksum is not a blake3 digest")?;
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
            expected_blake3,
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

    /// Verify and publish: the `.part` file is only renamed into place once the
    /// full length arrived and the digest matches, so anything that finds the
    /// final name can trust it.
    pub fn finish(self) -> Result<StagedUpdate, String> {
        // Take the struct apart so the file handle can be closed before the
        // rename — Windows will not rename a file that is still open.
        let Self {
            version,
            asset,
            expected_blake3,
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
        if digest != expected_blake3 {
            let _ = fs::remove_file(&part_path);
            return Err("the download did not match its published checksum".to_string());
        }

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

    /// Throw away a failed or cancelled download.
    pub fn discard(&self) {
        let _ = fs::remove_file(&self.part_path);
    }
}

/// Accept a hex digest in any case, rejecting anything that is not exactly a
/// 256-bit blake3 hash.
fn normalize_digest(digest: &str) -> Option<String> {
    // Checksum files often carry a trailing file name; take the first field.
    let digest = digest.split_whitespace().next()?.trim();
    if digest.len() != 64 || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(digest.to_ascii_lowercase())
}

/// Hash a file that is already on disk, to re-check a staged installer before
/// handing it to the installer program.
pub fn hash_file(path: &Path) -> io::Result<String> {
    let mut hasher = blake3::Hasher::new();
    let mut file = File::open(path)?;
    io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().to_hex().to_string())
}

/// Decode standard base64, which is how the page hands binary chunks across the
/// string-only IPC channel. Rejects any character outside the alphabet rather
/// than skipping it, so a corrupted message fails the transfer instead of
/// silently producing different bytes.
pub fn decode_base64(encoded: &str) -> Option<Vec<u8>> {
    const INVALID: u8 = 0xFF;
    let value = |character: u8| -> u8 {
        match character {
            b'A'..=b'Z' => character - b'A',
            b'a'..=b'z' => character - b'a' + 26,
            b'0'..=b'9' => character - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => INVALID,
        }
    };

    let bytes = encoded.as_bytes();
    let body = bytes.strip_suffix(b"==").unwrap_or(bytes);
    let body = body.strip_suffix(b"=").unwrap_or(body);
    let padding = bytes.len() - body.len();
    if padding > 2 || bytes.len() % 4 != 0 && !bytes.is_empty() {
        return None;
    }

    let mut out = Vec::with_capacity(body.len() / 4 * 3 + 3);
    let mut accumulator: u32 = 0;
    let mut collected = 0;
    for &character in body {
        let decoded = value(character);
        if decoded == INVALID {
            return None;
        }
        accumulator = (accumulator << 6) | u32::from(decoded);
        collected += 1;
        if collected == 4 {
            out.push((accumulator >> 16) as u8);
            out.push((accumulator >> 8) as u8);
            out.push(accumulator as u8);
            accumulator = 0;
            collected = 0;
        }
    }
    match collected {
        0 => {}
        2 => out.push((accumulator >> 4) as u8),
        3 => {
            out.push((accumulator >> 10) as u8);
            out.push((accumulator >> 2) as u8);
        }
        _ => return None,
    }
    Some(out)
}
