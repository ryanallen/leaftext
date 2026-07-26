//! Native clipboard and Recycle Bin/Trash access.
//!
//! Both operations are one system call on each platform, so they talk to the OS
//! directly rather than through a cross-platform crate. That keeps two whole
//! dependency subtrees (and their transitive supply chain) out of the build for
//! what amounts to a few dozen lines of platform code.
//!
//! Windows goes through Win32 (`windows-sys` is already a dependency for the
//! single-instance guard); macOS shells out, matching how the file-manager
//! reveal, file-copy, and Get Info actions in `main.rs` already work.

use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
pub use windows_impl::{move_to_trash, set_clipboard_text};

#[cfg(target_os = "macos")]
pub use macos_impl::{move_to_trash, set_clipboard_text};

/// Flag that puts the binary into update-applier mode instead of opening a
/// window. Not a user-facing option: the app passes it to a copy of itself.
pub const APPLY_UPDATE_FLAG: &str = "--apply-update";

/// What the applier was asked to do, parsed from the command line.
pub struct ApplyRequest {
    /// Staging folder holding the installer and its manifest.
    pub staging_dir: PathBuf,
    /// Executable to start once the install finishes.
    pub relaunch: PathBuf,
    /// Process to wait for before touching anything it might have open.
    pub wait_pid: Option<u32>,
}

/// Recognize `--apply-update <dir> --relaunch <exe> [--wait-pid <pid>]`.
/// Returns `None` for a normal launch.
pub fn parse_apply_request<I: Iterator<Item = String>>(args: I) -> Option<ApplyRequest> {
    let mut args = args.peekable();
    let mut staging_dir = None;
    let mut relaunch = None;
    let mut wait_pid = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            APPLY_UPDATE_FLAG => staging_dir = args.next().map(PathBuf::from),
            "--relaunch" => relaunch = args.next().map(PathBuf::from),
            "--wait-pid" => wait_pid = args.next().and_then(|value| value.parse().ok()),
            _ => {}
        }
    }
    Some(ApplyRequest {
        staging_dir: staging_dir?,
        relaunch: relaunch?,
        wait_pid,
    })
}

/// Launch a detached copy of this binary to do the install.
///
/// It has to be a *copy*: the installer replaces the running executable, and
/// Windows will not overwrite a file that is running. The staging folder is
/// somewhere the installer does not touch, and is pruned after the update lands.
pub fn spawn_update_helper(staging_dir: &Path) -> io::Result<()> {
    let current = std::env::current_exe()?;
    let helper_name = if cfg!(windows) {
        "leaftext-apply.exe"
    } else {
        "leaftext-apply"
    };
    let helper = staging_dir.join(helper_name);
    // A helper left behind by an earlier attempt may still be running; a failed
    // copy onto it is not fatal as long as some copy is there to run.
    if std::fs::copy(&current, &helper).is_err() && !helper.exists() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "could not stage the update helper",
        ));
    }

    let mut command = Command::new(&helper);
    command
        .arg(APPLY_UPDATE_FLAG)
        .arg(staging_dir)
        .arg("--relaunch")
        .arg(&current)
        .arg("--wait-pid")
        .arg(std::process::id().to_string());

    // DETACHED_PROCESS | CREATE_NO_WINDOW: the child must outlive this process
    // and must not flash a console while it runs msiexec.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0008 | 0x0800_0000);
    }

    command.spawn().map(|_| ())
}

/// Shared by both backends: a failure message naming the operation.
fn failed(operation: &str, detail: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::Other, format!("{operation}: {detail}"))
}

/// Install a staged update, then start the new build. Runs in the detached
/// helper copy, never in the app the user was using.
///
/// The installer is re-hashed first: it was verified when downloaded, but has
/// sat in a user-writable folder since, and this is the last moment before the
/// bytes are executed. Every failure path relaunches what was already
/// installed — a failed update must never cost the user a working app.
///
/// The outcome is recorded before the relaunch, since this process has no way to
/// report one itself. See `ApplyOutcome`.
pub fn run_update_apply(request: &ApplyRequest) -> Result<(), String> {
    let outcome = apply(request);
    leaftext::record_apply_outcome(
        &request.staging_dir,
        &applying_version(request),
        outcome.as_ref().err().map(String::as_str),
    );
    // Either way: on success the new build, on failure the old one. Last, so the
    // app coming up cannot race the verdict it is about to read.
    let _ = relaunch(&request.relaunch);
    outcome
}

/// The version named by the staging folder. Read off the path, not the manifest,
/// so an unreadable manifest is still attributed to a version.
fn applying_version(request: &ApplyRequest) -> String {
    request
        .staging_dir
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The install itself. Relaunching is the caller's job, so every path out of here
/// relaunches exactly once.
fn apply(request: &ApplyRequest) -> Result<(), String> {
    let manifest = std::fs::read_to_string(request.staging_dir.join("manifest.json"))
        .map_err(|error| format!("no staged update to apply: {error}"))?;
    let staged: leaftext::StagedUpdate =
        serde_json::from_str(&manifest).map_err(|error| format!("unreadable manifest: {error}"))?;
    let installer = request.staging_dir.join(&staged.asset);

    wait_for_exit(request.wait_pid);

    let digest = leaftext::hash_file(&installer)
        .map_err(|error| format!("could not re-read the installer: {error}"))?;
    if digest != staged.blake3 {
        return Err("the staged installer changed on disk since it was verified".to_string());
    }

    install(&installer, &request.relaunch)
}

/// Give the app that spawned us time to close its files and release the
/// executable. On Windows that wait is the difference between an install that
/// works and one that fails on a locked file.
fn wait_for_exit(pid: Option<u32>) {
    #[cfg(windows)]
    if let Some(pid) = pid {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
        const SYNCHRONIZE: u32 = 0x0010_0000;
        unsafe {
            let handle = OpenProcess(SYNCHRONIZE, 0, pid);
            if !handle.is_null() {
                // Capped: a hung parent should not strand the update forever.
                WaitForSingleObject(handle, 30_000);
                CloseHandle(handle);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = pid;
    // A short settle even after the handle signals: the process object goes away
    // before the last file handles always do.
    std::thread::sleep(std::time::Duration::from_millis(1500));
}

fn relaunch(executable: &Path) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        // Start the bundle rather than the inner binary, so it comes up as a
        // proper app with its Dock entry and activation policy.
        if let Some(bundle) = bundle_root(executable) {
            return Command::new("open").arg(bundle).spawn().map(|_| ());
        }
    }
    Command::new(executable).spawn().map(|_| ())
}

/// The `.app` directory containing an executable, if it is inside one.
#[cfg(target_os = "macos")]
fn bundle_root(executable: &Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .find(|ancestor| ancestor.extension().is_some_and(|kind| kind == "app"))
        .map(Path::to_path_buf)
}

/// Windows: hand the MSI to the installer service. `wix/main.wxs` declares a
/// `MajorUpgrade`, so this replaces the existing install rather than sitting
/// beside it.
///
/// No elevation, and none needed: the package installs per-user, which is the
/// entire reason for that scope. `/qn` on a per-machine package would fail with
/// 1925 instead of prompting, because quiet mode suppresses the UAC dialog too.
#[cfg(windows)]
fn install(installer: &Path, _relaunch: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let status = Command::new("msiexec")
        .arg("/i")
        .arg(installer)
        .args(["/qn", "/norestart"])
        // CREATE_NO_WINDOW: no console flash while it runs.
        .creation_flags(0x0800_0000)
        .status()
        .map_err(|error| format!("could not start the installer: {error}"))?;
    match status.code() {
        // 3010 is "installed, a reboot would be needed" — for a single
        // executable it never actually is.
        Some(0) | Some(3010) => Ok(()),
        Some(code) => Err(format!("the installer failed with code {code}")),
        None => Err("the installer was interrupted".to_string()),
    }
}

/// macOS: swap the application bundle.
///
/// The old bundle is moved aside before the new one is moved in, and only
/// deleted once the new one is in place, so a failure at any step leaves a
/// working app on disk under one name or the other.
#[cfg(target_os = "macos")]
fn install(installer: &Path, relaunch: &Path) -> Result<(), String> {
    let bundle = bundle_root(relaunch)
        .ok_or("the running app is not inside a .app bundle, so there is nothing to swap")?;
    let parent = bundle
        .parent()
        .ok_or("the app bundle has no containing folder")?;

    // /Applications is group-writable by admin on a default install, so an
    // admin user needs no prompt. A standard user cannot write there, and
    // should have been told to update by hand long before reaching this point.
    let probe = parent.join(".leaftext-write-probe");
    std::fs::write(&probe, b"")
        .map_err(|error| format!("{} is not writable: {error}", parent.display()))?;
    let _ = std::fs::remove_file(&probe);

    let unpacked = installer.with_extension("unpacked");
    let _ = std::fs::remove_dir_all(&unpacked);
    std::fs::create_dir_all(&unpacked)
        .map_err(|error| format!("could not create the unpack folder: {error}"))?;

    // ditto, not unzip: it preserves the resource forks and extended
    // attributes that a signed bundle depends on.
    let status = Command::new("ditto")
        .args(["-x", "-k"])
        .arg(installer)
        .arg(&unpacked)
        .status()
        .map_err(|error| format!("could not unpack the update: {error}"))?;
    if !status.success() {
        return Err(format!("unpacking the update failed with {status}"));
    }

    let new_bundle = std::fs::read_dir(&unpacked)
        .map_err(|error| format!("could not read the unpacked update: {error}"))?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|kind| kind == "app"))
        .ok_or("the update archive contained no .app bundle")?;

    let retired = bundle.with_extension("app.old");
    let _ = std::fs::remove_dir_all(&retired);
    std::fs::rename(&bundle, &retired)
        .map_err(|error| format!("could not move the old app aside: {error}"))?;
    if let Err(error) = std::fs::rename(&new_bundle, &bundle) {
        // Put it back rather than leaving the user with no app at all.
        let _ = std::fs::rename(&retired, &bundle);
        return Err(format!("could not move the new app into place: {error}"));
    }
    let _ = std::fs::remove_dir_all(&retired);
    let _ = std::fs::remove_dir_all(&unpacked);
    Ok(())
}

#[cfg(windows)]
mod windows_impl {
    use super::{failed, io, Path};
    use std::ptr;

    // GlobalFree is declared in Foundation rather than Memory alongside its
    // siblings, which is a windows-sys quirk, not a mistake here.
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, SHFILEOPSTRUCTW};

    /// Clipboard format id for UTF-16 text, and the file-operation constants.
    /// Spelled out rather than imported so a windows-sys bump that reshuffles
    /// module paths can't break the build over a constant.
    const CF_UNICODETEXT: u32 = 13;
    const FO_DELETE: u32 = 3;
    /// Recycle rather than erase — this is what makes the delete reversible.
    const FOF_ALLOWUNDO: u16 = 0x0040;
    const FOF_SILENT: u16 = 0x0004;
    const FOF_NOCONFIRMATION: u16 = 0x0010;
    const FOF_NOERRORUI: u16 = 0x0400;

    /// Put UTF-16 text on the clipboard.
    ///
    /// The clipboard takes ownership of the moveable global block on a successful
    /// `SetClipboardData`, so the block is only freed on the paths that fail
    /// before handing it over — freeing it after would corrupt the clipboard.
    pub fn set_clipboard_text(text: &str) -> io::Result<()> {
        let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes = std::mem::size_of_val(utf16.as_slice());

        unsafe {
            if OpenClipboard(ptr::null_mut()) == 0 {
                return Err(failed("open clipboard", io::Error::last_os_error()));
            }

            let block = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if block.is_null() {
                CloseClipboard();
                return Err(failed(
                    "allocate clipboard memory",
                    io::Error::last_os_error(),
                ));
            }

            let destination = GlobalLock(block).cast::<u16>();
            if destination.is_null() {
                GlobalFree(block);
                CloseClipboard();
                return Err(failed("lock clipboard memory", io::Error::last_os_error()));
            }
            ptr::copy_nonoverlapping(utf16.as_ptr(), destination, utf16.len());
            GlobalUnlock(block);

            if EmptyClipboard() == 0 {
                GlobalFree(block);
                CloseClipboard();
                return Err(failed("empty clipboard", io::Error::last_os_error()));
            }

            if SetClipboardData(CF_UNICODETEXT, block).is_null() {
                GlobalFree(block);
                CloseClipboard();
                return Err(failed("set clipboard data", io::Error::last_os_error()));
            }

            CloseClipboard();
        }
        Ok(())
    }

    /// Send a file to the Recycle Bin.
    ///
    /// `SHFileOperationW` wants an absolute path in a *double* null-terminated
    /// buffer (the field is a list, empty-string terminated), and it reports
    /// failure through its return value rather than the last-error channel.
    pub fn move_to_trash(path: &Path) -> Result<(), String> {
        let absolute = path
            .canonicalize()
            .map_err(|error| format!("resolve path: {error}"))?;
        // canonicalize hands back a \\?\ extended path, which SHFileOperationW
        // does not accept; the shell wants the plain drive-letter form.
        let display = absolute.to_string_lossy();
        let plain = display.strip_prefix(r"\\?\").unwrap_or(&display);

        let mut from: Vec<u16> = plain.encode_utf16().collect();
        from.push(0);
        from.push(0);

        let mut operation = SHFILEOPSTRUCTW {
            hwnd: ptr::null_mut(),
            wFunc: FO_DELETE,
            pFrom: from.as_ptr(),
            pTo: ptr::null(),
            fFlags: FOF_ALLOWUNDO | FOF_SILENT | FOF_NOCONFIRMATION | FOF_NOERRORUI,
            fAnyOperationsAborted: 0,
            hNameMappings: ptr::null_mut(),
            lpszProgressTitle: ptr::null(),
        };

        let result = unsafe { SHFileOperationW(&mut operation) };
        if result != 0 {
            return Err(format!("the Recycle Bin refused the file (code {result})"));
        }
        if operation.fAnyOperationsAborted != 0 {
            return Err("the delete was cancelled".to_string());
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::{failed, io, Path};
    use std::io::Write;
    use std::process::{Command, Stdio};

    /// Put text on the pasteboard through `pbcopy`, which ships with macOS.
    pub fn set_clipboard_text(text: &str) -> io::Result<()> {
        let mut child = Command::new("pbcopy").stdin(Stdio::piped()).spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(text.as_bytes())?;
        }
        let status = child.wait()?;
        if status.success() {
            Ok(())
        } else {
            Err(failed("pbcopy", status))
        }
    }

    /// Move a file to the Trash.
    ///
    /// Finder is asked first because a Finder delete records the Put Back
    /// location, which a plain move cannot. If that fails — Finder not running,
    /// or the automation permission declined — fall back to moving the file into
    /// `~/.Trash` ourselves, which still gets it out of the user's way.
    pub fn move_to_trash(path: &Path) -> Result<(), String> {
        let escaped = path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let finder = Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "tell application \"Finder\" to delete POSIX file \"{escaped}\""
            ))
            .status();
        if matches!(finder, Ok(status) if status.success()) {
            return Ok(());
        }
        move_into_trash_folder(path)
    }

    /// Fallback: rename into `~/.Trash`, uniquifying the name on collision so an
    /// existing trashed file of the same name is never clobbered.
    fn move_into_trash_folder(path: &Path) -> Result<(), String> {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        let trash = Path::new(&home).join(".Trash");
        let name = path
            .file_name()
            .ok_or("the path does not name a file")?
            .to_os_string();

        let mut target = trash.join(&name);
        let mut attempt = 1;
        while target.exists() {
            let stem = Path::new(&name)
                .file_stem()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default();
            let extension = Path::new(&name)
                .extension()
                .map(|value| format!(".{}", value.to_string_lossy()))
                .unwrap_or_default();
            target = trash.join(format!("{stem} {attempt}{extension}"));
            attempt += 1;
        }

        std::fs::rename(path, &target).map_err(|error| format!("move to Trash: {error}"))
    }
}
