//! Native clipboard, Recycle Bin/Trash, HTTPS download, and the stderr redirect behind the journal.
//!
//! Each is one system call or one bundled tool on each platform, so they talk to the OS directly rather than through a cross-platform crate. That keeps whole dependency subtrees (and their transitive supply chain) out of the build for what amounts to a few dozen lines of platform code.
//!
//! Windows goes through Win32 (`windows-sys` is already a dependency for the single-instance guard); macOS shells out, matching how the file-manager reveal, file-copy, and Get Info actions in `main.rs` already work.

#[cfg(unix)]
use std::ffi::c_int;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
pub use windows_impl::{download_to, move_to_trash, restore_from_trash, set_clipboard_text};

#[cfg(target_os = "macos")]
pub use macos_impl::{download_to, move_to_trash, restore_from_trash, set_clipboard_text};

/// Point this process's stderr at an already-open file. The Windows build has no console, so without this everything the app prints is thrown away.
///
/// Takes the file by value on purpose: on Windows the handle *becomes* stderr, so closing it would leave the process printing into a dead handle. Returns whether the swap took.
#[cfg(windows)]
pub fn redirect_stderr(file: File) -> bool {
    use std::os::windows::io::IntoRawHandle;
    use windows_sys::Win32::System::Console::{SetStdHandle, STD_ERROR_HANDLE};

    // Never closed: it is stderr for the rest of the run.
    let handle = file.into_raw_handle();
    unsafe { SetStdHandle(STD_ERROR_HANDLE, handle) != 0 }
}

/// The same, on any Unix.
///
/// `dup2` is declared here rather than pulling in `libc` for one symbol — the alternative is a whole crate that buys nothing else in this build. Gated on any Unix, not the Mac by name: the call is identical on Linux, so a Linux build would need no edit here.
#[cfg(unix)]
pub fn redirect_stderr(file: File) -> bool {
    use std::os::unix::io::AsRawFd;

    extern "C" {
        fn dup2(oldfd: c_int, newfd: c_int) -> c_int;
    }

    const STDERR: c_int = 2;
    // dup2 copies the descriptor, so this file may close on the way out.
    unsafe { dup2(file.as_raw_fd(), STDERR) != -1 }
}

/// How much of a download to hold before handing it on. Large enough that a 6 MB installer is a hundred or so calls, small enough that progress moves.
const DOWNLOAD_CHUNK_BYTES: usize = 64 * 1024;

/// Flag that puts the binary into update-applier mode instead of opening a window. Not a user-facing option: the app passes it to a copy of itself.
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

/// Recognize `--apply-update <dir> --relaunch <exe> [--wait-pid <pid>]`. Returns `None` for a normal launch.
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
/// It has to be a *copy*: the installer replaces the running executable, and Windows will not overwrite a file that is running. The staging folder is somewhere the installer does not touch, and is pruned after the update lands.
pub fn spawn_update_helper(staging_dir: &Path) -> io::Result<()> {
    let current = std::env::current_exe()?;
    let helper_name = if cfg!(windows) {
        "leaftext-apply.exe"
    } else {
        "leaftext-apply"
    };
    let helper = staging_dir.join(helper_name);
    // A helper left behind by an earlier attempt may still be running; a failed copy onto it is not fatal as long as some copy is there to run.
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

    // DETACHED_PROCESS | CREATE_NO_WINDOW: the child must outlive this process and must not flash a console while it runs msiexec.
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

/// Install a staged update, then start the new build. Runs in the detached helper copy, never in the app the user was using.
///
/// The installer is re-hashed first: it was verified when downloaded, but has sat in a user-writable folder since, and this is the last moment before the bytes are executed. Every failure path relaunches what was already installed — a failed update must never cost the user a working app.
///
/// The outcome is recorded before the relaunch, since this process has no way to report one itself. See `ApplyOutcome`.
pub fn run_update_apply(request: &ApplyRequest) -> Result<(), String> {
    let outcome = apply(request);
    leaftext::record_apply_outcome(
        &request.staging_dir,
        &applying_version(request),
        outcome.as_ref().err().map(String::as_str),
    );
    // Either way: on success the new build, on failure the old one. Last, so the app coming up cannot race the verdict it is about to read.
    let _ = relaunch(&request.relaunch);
    outcome
}

/// The version named by the staging folder. Read off the path, not the manifest, so an unreadable manifest is still attributed to a version.
fn applying_version(request: &ApplyRequest) -> String {
    request
        .staging_dir
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The install itself. Relaunching is the caller's job, so every path out of here relaunches exactly once.
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

/// Give the app that spawned us time to close its files and release the executable. On Windows that wait is the difference between an install that works and one that fails on a locked file.
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
    // A short settle even after the handle signals: the process object goes away before the last file handles always do.
    std::thread::sleep(std::time::Duration::from_millis(1500));
}

fn relaunch(executable: &Path) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        // Start the bundle rather than the inner binary, so it comes up as a proper app with its Dock entry and activation policy.
        if let Some(bundle) = bundle_root(executable) {
            return Command::new("open").arg(bundle).spawn().map(|_| ());
        }
    }
    Command::new(executable).spawn().map(|_| ())
}

/// The single `.app` bundle at the root of a mounted image. Anything else there (the `/Applications` symlink the DMG carries for drag-installing) is skipped.
#[cfg(target_os = "macos")]
fn mounted_bundle(mount: &Path) -> Result<PathBuf, String> {
    std::fs::read_dir(mount)
        .map_err(|error| format!("could not read the mounted image: {error}"))?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.is_dir() && path.extension().is_some_and(|kind| kind == "app"))
        .ok_or_else(|| "the disk image contained no .app bundle".to_string())
}

/// The `.app` directory containing an executable, if it is inside one.
#[cfg(target_os = "macos")]
fn bundle_root(executable: &Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .find(|ancestor| ancestor.extension().is_some_and(|kind| kind == "app"))
        .map(Path::to_path_buf)
}

/// Windows: run the staged installer, whichever of the two it is.
///
/// An MSI goes to the installer service; `wix/main.wxs` declares a `MajorUpgrade`, so it replaces the existing install rather than sitting beside it. An EXE is the app's own installer and takes `--silent`. Which one is staged is decided when the update is found, by `platform_update_asset_suffix` below, so a copy keeps updating through the file that put it there and is never handed one its machine refuses.
///
/// No elevation on either, and none needed: both install per-user, which is the entire reason for that scope. `/qn` on a per-machine package would fail with 1925 instead of prompting, because quiet mode suppresses the UAC dialog too.
#[cfg(windows)]
fn install(installer: &Path, _relaunch: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let mut command = installer_command(installer)?;
    let status = command
        // CREATE_NO_WINDOW: no console flash while it runs.
        .creation_flags(0x0800_0000)
        .status()
        .map_err(|error| format!("could not start the installer: {error}"))?;
    match status.code() {
        // 3010 is "installed, a reboot would be needed" — for a single executable it never actually is.
        Some(0) | Some(3010) => Ok(()),
        Some(code) => Err(installer_exit_code_meaning(installer, code)),
        None => Err("the installer was interrupted".to_string()),
    }
}

/// The program that installs a staged file, chosen by its extension, so an MSI can never be handed to the EXE's command line or the reverse.
#[cfg(windows)]
pub(crate) fn installer_command(installer: &Path) -> Result<Command, String> {
    let extension = installer
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "msi" => {
            let mut command = Command::new("msiexec");
            command.arg("/i").arg(installer).args(["/qn", "/norestart"]);
            Ok(command)
        }
        "exe" => {
            let mut command = Command::new(installer);
            command.arg("--silent");
            Ok(command)
        }
        other => Err(format!("nothing installs a .{other} on Windows")),
    }
}

/// What a non-zero exit means, in words.
///
/// `msiexec` has hundreds of codes and Windows already writes them to the event log, so it gets the number alone. The app's own installer has four, each a separate thing to tell somebody, and this is the only place that reads them back — the installer itself is silent by then, with no window and no console. `installer/src/exit.rs` is the list, and `the_installers_exit_codes_mean_what_the_installer_says_they_mean` holds this to it.
#[cfg(windows)]
pub(crate) fn installer_exit_code_meaning(installer: &Path, code: i32) -> String {
    let ours = installer
        .extension()
        .is_some_and(|value| value.eq_ignore_ascii_case("exe"));
    if !ours {
        return format!("the installer failed with code {code}");
    }
    match code {
        2 => "Leaftext was still open, so nothing was changed".to_string(),
        3 => "that installer was built without the app inside it".to_string(),
        4 => "the installer did not understand how it was run".to_string(),
        other => format!("the installer failed with code {other}"),
    }
}

/// Which release asset this copy updates through: on Windows, whichever installer put it here.
///
/// The marker sits beside the values the MSI already writes, and its absence means the MSI — that is what every copy on disk today looks like, so nothing had to be written for them. Nobody chooses this and no setting holds it: a reader on a machine that refuses MSI packages took the EXE, and that is the fact the value records.
pub fn platform_update_asset_suffix() -> &'static str {
    #[cfg(windows)]
    {
        leaftext::windows_asset_suffix(windows_impl::installed_by().as_deref())
    }
    #[cfg(not(windows))]
    {
        leaftext::platform_asset_suffix()
    }
}

/// macOS: mount the disk image, copy the bundle out, and swap it into place.
///
/// The old bundle is moved aside before the new one is moved in, and only deleted once the new one is in place, so a failure at any step leaves a working app on disk under one name or the other.
#[cfg(target_os = "macos")]
fn install(installer: &Path, relaunch: &Path) -> Result<(), String> {
    let bundle = bundle_root(relaunch)
        .ok_or("the running app is not inside a .app bundle, so there is nothing to swap")?;
    let parent = bundle
        .parent()
        .ok_or("the app bundle has no containing folder")?;

    // /Applications is group-writable by admin on a default install, so an admin user needs no prompt. A standard user cannot write there, and should have been told to update by hand long before reaching this point.
    let probe = parent.join(".leaftext-write-probe");
    std::fs::write(&probe, b"")
        .map_err(|error| format!("{} is not writable: {error}", parent.display()))?;
    let _ = std::fs::remove_file(&probe);

    let unpacked = installer.with_extension("unpacked");
    let _ = std::fs::remove_dir_all(&unpacked);
    std::fs::create_dir_all(&unpacked)
        .map_err(|error| format!("could not create the unpack folder: {error}"))?;

    // macOS publishes one file, the disk image a person double-clicks, so the bundle is copied out of that. Read-only and -nobrowse: nothing should appear in Finder mid-install.
    let mount = installer.with_extension("mount");
    let _ = Command::new("hdiutil")
        .args(["detach", "-force"])
        .arg(&mount)
        .status();
    let _ = std::fs::remove_dir_all(&mount);
    std::fs::create_dir_all(&mount)
        .map_err(|error| format!("could not create the mount point: {error}"))?;

    let status = Command::new("hdiutil")
        .arg("attach")
        .arg(installer)
        .arg("-mountpoint")
        .arg(&mount)
        .args(["-nobrowse", "-readonly", "-noverify", "-noautoopen"])
        .status()
        .map_err(|error| format!("could not mount the update: {error}"))?;
    if !status.success() {
        return Err(format!("mounting the update failed with {status}"));
    }

    // Everything from here to the detach has to release the mount, so the copy's outcome is held rather than returned.
    let copied = mounted_bundle(&mount).and_then(|source| {
        let name = source
            .file_name()
            .ok_or_else(|| "the bundle on the image has no name".to_string())?;
        // ditto, not a directory copy: it preserves the resource forks and extended attributes the bundle's signature depends on.
        let destination = unpacked.join(name);
        let status = Command::new("ditto")
            .arg(&source)
            .arg(&destination)
            .status()
            .map_err(|error| format!("could not copy the update off the image: {error}"))?;
        if !status.success() {
            return Err(format!("copying the update failed with {status}"));
        }
        Ok(destination)
    });

    // Detach whatever happened; a left-behind mount would block the next attempt.
    let _ = Command::new("hdiutil")
        .args(["detach", "-force"])
        .arg(&mount)
        .status();
    let _ = std::fs::remove_dir_all(&mount);
    let new_bundle = copied?;

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
    use super::{failed, io, Path, PathBuf, DOWNLOAD_CHUNK_BYTES};
    use core::ffi::c_void;
    use std::ptr;
    use url::Url;

    // GlobalFree is declared in Foundation rather than Memory alongside its siblings, which is a windows-sys quirk, not a mistake here.
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders,
        WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetTimeouts,
        INTERNET_DEFAULT_HTTPS_PORT, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE,
        WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
    };
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, SHFILEOPSTRUCTW};

    /// A null-terminated UTF-16 string, which is what every W-suffixed call wants.
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Closes a WinHTTP handle on the way out. The three handles nest — session, connection, request — and every error path has to unwind all of them.
    struct WinHttpHandle(*mut c_void);

    impl Drop for WinHttpHandle {
        fn drop(&mut self) {
            unsafe { WinHttpCloseHandle(self.0) };
        }
    }

    /// Take ownership of a handle, or name what failed to produce one.
    fn opened(handle: *mut c_void, operation: &str) -> Result<WinHttpHandle, String> {
        if handle.is_null() {
            return Err(format!("{operation}: {}", io::Error::last_os_error()));
        }
        Ok(WinHttpHandle(handle))
    }

    /// Stream an HTTPS GET to `sink`, one chunk at a time.
    ///
    /// WinHTTP ships with Windows and uses the system certificate store, so this links no TLS stack in. It follows the redirect a release asset always makes, and its default policy refuses an HTTPS-to-HTTP downgrade on the way.
    pub fn download_to(
        url: &str,
        sink: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        let parsed = Url::parse(url).map_err(|error| format!("unusable download URL: {error}"))?;
        if parsed.scheme() != "https" {
            return Err("refusing a download that is not HTTPS".to_string());
        }
        let host = parsed
            .host_str()
            .ok_or_else(|| "the download URL names no host".to_string())?;
        let port = parsed.port().unwrap_or(INTERNET_DEFAULT_HTTPS_PORT);
        // WinHTTP wants the path and query as one "object name"; it takes no URL.
        let mut object = parsed.path().to_string();
        if let Some(query) = parsed.query() {
            object.push('?');
            object.push_str(query);
        }

        let agent = wide("leaftext-updater");
        let session = opened(
            unsafe {
                WinHttpOpen(
                    agent.as_ptr(),
                    WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                    ptr::null(),
                    ptr::null(),
                    0,
                )
            },
            "could not start an HTTPS session",
        )?;

        // Finite, so a stalled server cannot pin the download thread forever. The receive timeout covers the wait for the next chunk, not the whole transfer, so a slow connection is not cut off part way through.
        unsafe { WinHttpSetTimeouts(session.0, 15_000, 15_000, 30_000, 60_000) };

        let host_wide = wide(host);
        let connection = opened(
            unsafe { WinHttpConnect(session.0, host_wide.as_ptr(), port, 0) },
            "could not reach the download host",
        )?;

        let verb = wide("GET");
        let object_wide = wide(&object);
        let request = opened(
            unsafe {
                WinHttpOpenRequest(
                    connection.0,
                    verb.as_ptr(),
                    object_wide.as_ptr(),
                    ptr::null(),
                    ptr::null(),
                    ptr::null(),
                    WINHTTP_FLAG_SECURE,
                )
            },
            "could not open the download request",
        )?;

        if unsafe { WinHttpSendRequest(request.0, ptr::null(), 0, ptr::null(), 0, 0, 0) } == 0 {
            return Err(format!(
                "could not send the download request: {}",
                io::Error::last_os_error()
            ));
        }
        if unsafe { WinHttpReceiveResponse(request.0, ptr::null_mut()) } == 0 {
            return Err(format!(
                "no answer to the download request: {}",
                io::Error::last_os_error()
            ));
        }

        // WINHTTP_QUERY_FLAG_NUMBER asks for the status as a u32 rather than text.
        let mut status: u32 = 0;
        let mut status_length = std::mem::size_of::<u32>() as u32;
        if unsafe {
            WinHttpQueryHeaders(
                request.0,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                ptr::null(),
                ptr::addr_of_mut!(status).cast(),
                &mut status_length,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(format!(
                "could not read the download response: {}",
                io::Error::last_os_error()
            ));
        }
        if !(200..300).contains(&status) {
            return Err(format!("the download server answered {status}"));
        }

        let mut buffer = vec![0u8; DOWNLOAD_CHUNK_BYTES];
        loop {
            let mut read: u32 = 0;
            if unsafe {
                WinHttpReadData(
                    request.0,
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    &mut read,
                )
            } == 0
            {
                return Err(format!(
                    "the download stopped: {}",
                    io::Error::last_os_error()
                ));
            }
            // Zero bytes on a successful read is the end of the body.
            if read == 0 {
                return Ok(());
            }
            sink(&buffer[..read as usize])?;
        }
    }

    /// Which installer put this copy on the machine, out of the key both installers write. `None` means nothing wrote one, which is an MSI install.
    pub fn installed_by() -> Option<String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ,
        };

        let key = wide(r"Software\ryanallen\leaftext");
        let name = wide("InstalledBy");
        let mut buffer = [0u16; 64];
        let mut bytes = std::mem::size_of_val(&buffer) as u32;
        let read = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        if read != ERROR_SUCCESS {
            return None;
        }
        let text: Vec<u16> = buffer.into_iter().take_while(|unit| *unit != 0).collect();
        (!text.is_empty()).then(|| String::from_utf16_lossy(&text))
    }

    /// Clipboard format id for UTF-16 text, and the file-operation constants. Spelled out rather than imported so a windows-sys bump that reshuffles module paths can't break the build over a constant.
    const CF_UNICODETEXT: u32 = 13;
    const FO_DELETE: u32 = 3;
    /// Recycle rather than erase — this is what makes the delete reversible.
    const FOF_ALLOWUNDO: u16 = 0x0040;
    const FOF_SILENT: u16 = 0x0004;
    const FOF_NOCONFIRMATION: u16 = 0x0010;
    const FOF_NOERRORUI: u16 = 0x0400;

    /// Put UTF-16 text on the clipboard.
    ///
    /// The clipboard takes ownership of the moveable global block on a successful `SetClipboardData`, so the block is only freed on the paths that fail before handing it over — freeing it after would corrupt the clipboard.
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
    /// `SHFileOperationW` wants an absolute path in a *double* null-terminated buffer (the field is a list, empty-string terminated), and it reports failure through its return value rather than the last-error channel.
    ///
    /// Nothing comes back saying where the file went, and nothing needs to: the bin records the folder each item came from, so `restore_from_trash` finds it again from the original path alone.
    pub fn move_to_trash(path: &Path) -> Result<Option<PathBuf>, String> {
        let absolute = path
            .canonicalize()
            .map_err(|error| format!("resolve path: {error}"))?;
        // canonicalize hands back a \\?\ extended path, which SHFileOperationW does not accept; the shell wants the plain drive-letter form.
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
            return Err("the delete was canceled".to_string());
        }
        Ok(None)
    }

    /// Put a file back where it was deleted from.
    ///
    /// The shell's own move, driven through PowerShell the way the properties window is: it finds the item by the folder the bin recorded against it, and moving it out is what clears the bin's index entry too — renaming the `$R` file off the disk would strip the file and leave the entry behind. The verb on the item's own menu is translated, so it is never named; `MoveHere` is not.
    ///
    /// `trashed` is ignored here. Windows never says where the file went, because the bin is a namespace rather than a place.
    pub fn restore_from_trash(original: &Path, _trashed: Option<&Path>) -> Result<(), String> {
        // Whatever took the name is a different file, and the shell's move overwrites without asking once it is told not to confirm — so the refusal has to be ours.
        if original.exists() {
            return Err(format!(
                "something else is called {} there now, so the file stayed in the Recycle Bin",
                original
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default()
            ));
        }
        // Single-quoted inside, because PowerShell re-parses what `-Command` is handed and a double quote would not survive the trip. Exit codes rather than output: 2 is nothing matching in the bin, 3 is the move never landing. The move is asynchronous, hence the wait.
        const SCRIPT: &str = "$t = $env:LEAF_TARGET;\
            $dir = Split-Path $t;\
            $leaf = Split-Path $t -Leaf;\
            $shell = New-Object -ComObject Shell.Application;\
            $bin = $shell.Namespace(10);\
            $hit = $null;\
            foreach ($it in $bin.Items()) {\
              if ($it.Name -eq $leaf -and $it.ExtendedProperty('System.Recycle.DeletedFrom') -eq $dir) {\
                if ($null -eq $hit -or $it.ExtendedProperty('System.Recycle.DateDeleted') -gt $hit.ExtendedProperty('System.Recycle.DateDeleted')) { $hit = $it }\
              }\
            };\
            if ($null -eq $hit) { exit 2 };\
            $shell.Namespace($dir).MoveHere($hit, 20);\
            for ($n = 0; $n -lt 100; $n++) { if (Test-Path $t) { exit 0 }; Start-Sleep -Milliseconds 50 };\
            exit 3";
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
            .env("LEAF_TARGET", original)
            // CREATE_NO_WINDOW keeps the helper from flashing a console window.
            .creation_flags(0x0800_0000)
            .output()
            .map_err(|error| format!("could not reach the Recycle Bin: {error}"))?;
        match output.status.code() {
            Some(0) => Ok(()),
            Some(2) => Err("that file is not in the Recycle Bin any more".to_string()),
            _ => Err("the Recycle Bin would not give the file back".to_string()),
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::{failed, io, Path, PathBuf, DOWNLOAD_CHUNK_BYTES};
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};

    /// Stream an HTTPS GET to `sink`, one chunk at a time, through the `curl` that ships with macOS: it trusts the system keychain, so this links no TLS stack in. `--proto`/`--proto-redir` hold the transfer to HTTPS across the redirect a release asset always makes. The bytes come back over a pipe rather than being written by curl, because a file the app writes carries no `com.apple.quarantine`.
    pub fn download_to(
        url: &str,
        sink: &mut dyn FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut child = Command::new("/usr/bin/curl")
            .args([
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--proto",
                "=https",
                "--proto-redir",
                "=https",
                "--max-redirs",
                "10",
                "--connect-timeout",
                "15",
                // Give up on a connection delivering less than a byte a second for a minute, rather than hanging on a dead socket.
                "--speed-limit",
                "1",
                "--speed-time",
                "60",
                "--",
                url,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("could not start the download: {error}"))?;

        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "the download produced no output".to_string())?;
        let mut buffer = vec![0u8; DOWNLOAD_CHUNK_BYTES];
        let streamed = loop {
            match stdout.read(&mut buffer) {
                Ok(0) => break Ok(()),
                Ok(read) => {
                    if let Err(error) = sink(&buffer[..read]) {
                        break Err(error);
                    }
                }
                Err(error) => break Err(format!("could not read the download: {error}")),
            }
        };
        // Close the pipe before waiting. A sink that gave up leaves curl writing into a reader that is gone; it has to be allowed to die on that rather than block this thread forever.
        drop(stdout);
        let finished = child.wait_with_output();

        // A sink or pipe failure is the more specific answer, so it wins over whatever exit code curl reported on its way out.
        streamed?;

        let finished =
            finished.map_err(|error| format!("could not finish the download: {error}"))?;
        if finished.status.success() {
            return Ok(());
        }
        let detail = String::from_utf8_lossy(&finished.stderr).trim().to_string();
        Err(if detail.is_empty() {
            format!("the download failed with {}", finished.status)
        } else {
            detail
        })
    }

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

    /// Move a file to the Trash, and say where it landed.
    ///
    /// Finder is asked first because a Finder delete records the Put Back location, which a plain move cannot. If that fails — Finder not running, or the automation permission declined — fall back to moving the file into `~/.Trash` ourselves, which still gets it out of the user's way.
    ///
    /// Finder's delete hands back the item it just trashed, so asking for its POSIX path is one clause more of the same one-line script — the app learns the name in the Trash without giving Put Back up. Undo is then a plain rename back, with no Finder and no automation prompt at the moment somebody is waiting.
    pub fn move_to_trash(path: &Path) -> Result<Option<PathBuf>, String> {
        let escaped = path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let finder = Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "tell application \"Finder\" to POSIX path of (delete POSIX file \"{escaped}\")"
            ))
            .output();
        if let Ok(done) = finder {
            if done.status.success() {
                let landed = String::from_utf8_lossy(&done.stdout).trim().to_string();
                // A Finder that answered but named nothing still deleted the file; the undo is what is lost, not the delete.
                return Ok((!landed.is_empty()).then(|| PathBuf::from(landed)));
            }
        }
        move_into_trash_folder(path).map(Some)
    }

    /// Put a file back where it was deleted from.
    ///
    /// Both delete paths hand back a real path in the Trash, so this is a rename and nothing more — no Finder, no automation prompt, and nothing to enumerate.
    pub fn restore_from_trash(original: &Path, trashed: Option<&Path>) -> Result<(), String> {
        let from = trashed.ok_or("the app does not know where that file went")?;
        if !from.exists() {
            return Err("that file is not in the Trash any more".to_string());
        }
        // Whatever took the name is a different file, and a rename would write straight over it.
        if original.exists() {
            return Err(format!(
                "something else is called {} there now, so the file stayed in the Trash",
                original
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default()
            ));
        }
        std::fs::rename(from, original).map_err(|error| format!("move out of the Trash: {error}"))
    }

    /// Fallback: rename into `~/.Trash`, uniquifying the name on collision so an existing trashed file of the same name is never clobbered. Hands back the name it wrote, which is the whole reason undo can find it again.
    fn move_into_trash_folder(path: &Path) -> Result<PathBuf, String> {
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

        std::fs::rename(path, &target).map_err(|error| format!("move to Trash: {error}"))?;
        Ok(target)
    }
}
