//! Laying the plan down, and taking it back up again.
//!
//! Nothing here decides anything: every path, key and value came out of `plan.rs`. What it adds is order and refusal — the files go first, because a locked executable is the one failure that has to stop the install before a single registry value is written. Half an install is worse than none: the reader is left with associations pointing at an app that is not there.

use std::io::Read;
use std::path::{Path, PathBuf};

use crate::exit::{self, Failure};
use crate::plan::{Content, Plan};
use crate::registry;
use crate::shortcut;

/// Where the app's bytes and the uninstaller's copy come from. Handed in rather than reached for, so a test can install something small.
pub struct Sources<'a> {
    /// The app binary, already unpacked.
    pub app: &'a [u8],
    /// The file to leave behind as the uninstaller — the running installer itself.
    pub uninstaller: &'a Path,
}

/// Write everything the plan describes. `prefix` puts the registry half under a scratch key; the installer passes `None`.
pub fn install(plan: &Plan, sources: &Sources, prefix: Option<&str>) -> Result<(), Failure> {
    for folder in &plan.folders {
        std::fs::create_dir_all(folder).map_err(|error| {
            Failure::failed(format!("could not create {}: {error}", folder.display()))
        })?;
    }

    for file in &plan.files {
        let bytes;
        let content: &[u8] = match file.content {
            Content::App => sources.app,
            Content::Uninstaller => {
                bytes = std::fs::read(sources.uninstaller).map_err(|error| {
                    Failure::failed(format!(
                        "could not read {}: {error}",
                        sources.uninstaller.display()
                    ))
                })?;
                &bytes
            }
        };
        write_over(&file.path, content)?;
    }

    for value in &plan.values {
        registry::set(prefix, value).map_err(Failure::failed)?;
    }

    for link in &plan.shortcuts {
        shortcut::write(link).map_err(Failure::failed)?;
    }

    Ok(())
}

/// Remove exactly what `install` wrote, and nothing else.
///
/// Values are removed one at a time except under the keys this install owns outright, which go whole. `Software\Classes\.md` may have been on the machine before the app and has to survive it, so only the value pointing at our document class is taken out of it.
pub fn uninstall(plan: &Plan, prefix: Option<&str>) -> Result<(), Failure> {
    for link in &plan.shortcuts {
        let _ = std::fs::remove_file(&link.path);
    }

    for value in &plan.values {
        if plan
            .owned_keys
            .iter()
            .any(|owned| value.key == *owned || value.key.starts_with(&format!(r"{owned}\")))
        {
            continue;
        }
        registry::remove_value(prefix, value).map_err(Failure::failed)?;
    }
    for key in &plan.owned_keys {
        registry::remove_tree(prefix, key);
    }

    for file in &plan.files {
        let _ = std::fs::remove_file(&file.path);
    }
    // Deepest first, and `remove_dir` only takes an empty one — so a folder shared with something else is left alone.
    for folder in plan.folders.iter().rev() {
        let _ = std::fs::remove_dir(folder);
    }

    Ok(())
}

/// Write `content` at `path`, replacing whatever is there.
///
/// A running executable cannot be deleted but can be renamed, which is how an app replaces itself. If neither works the app is open with a lock nothing here can break, and that is a refusal with a reason rather than a folder half rewritten.
fn write_over(path: &Path, content: &[u8]) -> Result<(), Failure> {
    if path.exists() {
        if std::fs::remove_file(path).is_err() {
            let retired = path.with_extension("old");
            let _ = std::fs::remove_file(&retired);
            if std::fs::rename(path, &retired).is_err() {
                return Err(Failure::new(
                    exit::IN_USE,
                    format!(
                        "{} is in use — close Leaftext and run this again",
                        path.file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_else(|| path.display().to_string())
                    ),
                ));
            }
        }
    }
    std::fs::write(path, content)
        .map_err(|error| Failure::failed(format!("could not write {}: {error}", path.display())))
}

/// Unpack the payload the build script deflated into the binary.
pub fn unpack(payload: &[u8], expected: usize) -> Result<Vec<u8>, Failure> {
    if payload.is_empty() || expected == 0 {
        return Err(Failure::new(
            exit::NO_PAYLOAD,
            "this installer was built without the app inside it",
        ));
    }
    let mut app = Vec::with_capacity(expected);
    flate2::read::DeflateDecoder::new(payload)
        .read_to_end(&mut app)
        .map_err(|error| {
            Failure::new(
                exit::NO_PAYLOAD,
                format!("the app inside the installer could not be unpacked: {error}"),
            )
        })?;
    if app.len() != expected {
        return Err(Failure::new(
            exit::NO_PAYLOAD,
            format!(
                "the app inside the installer is {} bytes, not {expected}",
                app.len()
            ),
        ));
    }
    Ok(app)
}

/// Whether the uninstaller has to move before it can work: a program cannot delete the folder it is running from. It copies itself into the temporary folder and runs again from there.
pub fn uninstall_needs_relocation(running: &Path, folder: &Path) -> bool {
    running.starts_with(folder)
}

/// Where that copy goes.
pub fn relocated_uninstaller() -> PathBuf {
    std::env::temp_dir().join("leaftext-uninstall.exe")
}
