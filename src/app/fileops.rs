//! Acting on a file the way the OS file manager would.

use super::*;

pub(crate) fn open_with_os(target: &str) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(target)
        .status()?;

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(target).status()?;

    if status.success() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("OS opener exited with status {status}"),
        ))
    }
}

/// Open the OS file manager with `path` selected: Explorer on Windows, Finder on macOS.
pub(crate) fn reveal_in_file_manager(path: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // `explorer /select,<path>` highlights the file. Spawn rather than wait (Explorer returns non-zero even on success). Explorer needs `/select,` outside the quotes with only the path quoted, so build the arg verbatim with `raw_arg`; the std escaper would quote the whole token and break it.
        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open").arg("-R").arg(path).status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("Finder reveal exited with status {status}"),
            ))
        };
    }
}

/// Put the file on the system clipboard for pasting into the OS file manager. `cut` requests move semantics.
pub(crate) fn copy_file_to_clipboard(path: &Path, cut: bool) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // "Preferred DropEffect" 2 = move (cut), 5 = copy, read by the shell on paste. SetDataObject(_, $true) flushes so it survives PowerShell exiting; clipboard needs STA. Path/effect via env to avoid quoting.
        const SCRIPT: &str = "Add-Type -AssemblyName System.Windows.Forms;\
            $files = New-Object System.Collections.Specialized.StringCollection;\
            [void]$files.Add($env:LEAF_CLIP_PATH);\
            $data = New-Object System.Windows.Forms.DataObject;\
            $data.SetFileDropList($files);\
            $ms = New-Object System.IO.MemoryStream;\
            $bytes = [System.BitConverter]::GetBytes([int]$env:LEAF_CLIP_EFFECT);\
            $ms.Write($bytes, 0, 4);\
            $data.SetData('Preferred DropEffect', $ms);\
            [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)";
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW keeps the helper from flashing a console window.
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
            .env("LEAF_CLIP_PATH", path)
            .env("LEAF_CLIP_EFFECT", if cut { "2" } else { "5" })
            .creation_flags(0x0800_0000)
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        // macOS has no clipboard "cut"; both put the file on the pasteboard (the move is the user's Cmd+Opt+V on paste).
        let _ = cut;
        let escaped = path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let status = Command::new("osascript")
            .arg("-e")
            .arg(format!("set the clipboard to POSIX file \"{escaped}\""))
            .status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("osascript exited with status {status}"),
            ))
        };
    }
}

/// Copy a file's path (as text) to the clipboard.
pub(crate) fn copy_path_to_clipboard(path: &Path) -> io::Result<()> {
    platform::set_clipboard_text(&path.display().to_string())
}

/// Rename a file in place. The new name must be a bare file name: empty names, path separators, and the dot entries are rejected so the action can never move the file or escape its folder. Returns the new path.
pub(crate) fn rename_file(path: &Path, new_name: &str) -> io::Result<PathBuf> {
    let trimmed = new_name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "rename needs a non-empty file name with no path separators",
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "the file has no parent folder")
    })?;
    let target = parent.join(trimmed);
    if target == path {
        return Ok(target);
    }
    if target.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "a file with that name already exists",
        ));
    }
    fs::rename(path, &target)?;
    Ok(target)
}

/// Move or copy `source` into `folder`, keeping its name — the library pane's paste. A cut pastes as a move, a copy as a copy.
///
/// Refuses rather than guesses, in every case where guessing would lose something: a name already taken in the destination is not overwritten, and a folder cannot be put inside itself. A move within one volume is a rename; across volumes only files can go, by copying and then removing the original.
pub(crate) fn transfer_into_folder(
    source: &Path,
    folder: &Path,
    move_it: bool,
) -> io::Result<PathBuf> {
    if !source.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{} is not there any more", source.display()),
        ));
    }
    if !folder.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} is not a folder", folder.display()),
        ));
    }
    let name = source.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "that path has no file name to keep",
        )
    })?;
    let target = folder.join(name);

    // Already where it is being sent: a paste into the folder the file is in. Nothing to do, and nothing wrong.
    if same_path(&target, source) {
        return Ok(target);
    }
    // A folder cannot contain itself. Without this, `rename` either errors obscurely or, worse, succeeds partway.
    if source.is_dir() && canonical(folder).starts_with(canonical(source)) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a folder can't be put inside itself",
        ));
    }
    if target.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!(
                "{} already has something called {}",
                folder.display(),
                name.to_string_lossy()
            ),
        ));
    }

    if !move_it {
        if source.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "copying a whole folder isn't supported",
            ));
        }
        fs::copy(source, &target)?;
        return Ok(target);
    }

    match fs::rename(source, &target) {
        Ok(()) => Ok(target),
        // Different volume: rename can't span one. A file can still go by copy then remove; a folder is left to the file manager rather than half-copied by us.
        Err(error) if source.is_file() => {
            fs::copy(source, &target).map_err(|_| error)?;
            match fs::remove_file(source) {
                Ok(()) => Ok(target),
                // The copy landed, so the file is where it was asked to be; the original outliving it is worth saying, not worth undoing.
                Err(remove_error) => {
                    eprintln!(
                        "Moved {} but could not remove the original: {remove_error}",
                        source.display()
                    );
                    Ok(target)
                }
            }
        }
        Err(error) => Err(error),
    }
}

fn canonical(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn same_path(left: &Path, right: &Path) -> bool {
    left == right || canonical(left) == canonical(right)
}

/// Move a file to the OS trash / Recycle Bin (reversible).
pub(crate) fn delete_to_trash(path: &Path) -> Result<(), String> {
    platform::move_to_trash(path)
}

/// Open the OS file-properties view: the Properties dialog on Windows, Finder's Get Info on macOS.
pub(crate) fn show_properties(path: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // The shell Properties verb is modal to the caller, so the helper must linger for the dialog; best-effort. Path via env var.
        const SCRIPT: &str = "$p = $env:LEAF_TARGET;\
            $shell = New-Object -ComObject Shell.Application;\
            $folder = $shell.Namespace((Split-Path $p));\
            $item = $folder.ParseName((Split-Path $p -Leaf));\
            $item.InvokeVerb('Properties');\
            Start-Sleep -Seconds 3";
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW keeps the helper from flashing a console window.
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
            .env("LEAF_TARGET", path)
            .creation_flags(0x0800_0000)
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let escaped = path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let status = Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "tell application \"Finder\" to open information window of (POSIX file \"{escaped}\")"
            ))
            .status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("osascript exited with status {status}"),
            ))
        };
    }
}

/// Write the flowchart sheet's diagram out as its own file. The page made the bytes; this asks where they go, puts them there, and says how it went.
///
/// Nothing about the open document changes. An export is a file beside it.
pub(crate) fn export_diagram(
    webview: Option<&WebView>,
    document: Option<&Path>,
    format: &str,
    data: &str,
    width: u32,
    height: u32,
) {
    let (extension, label) = match format {
        "md" => ("md", "Markdown"),
        "png" => ("png", "PNG image"),
        // Not a format the sheet offers, so not a file anyone asked for.
        _ => return,
    };
    let bytes = if extension == "png" {
        // The page sends pixels, not a PNG: ours palettes the drawing and writes it unfiltered, which the canvas cannot do. See src/png.rs.
        match decode_base64(data).and_then(|rgba| encode_rgba(&rgba, width, height)) {
            Some(bytes) if !bytes.is_empty() => bytes,
            // A half-decoded picture is worse than none, so nothing is written.
            _ => {
                report_file_action_failure(
                    webview,
                    "That picture could not be read, so nothing was written.",
                );
                return;
            }
        }
    } else {
        data.as_bytes().to_vec()
    };
    let stem = document
        .and_then(Path::file_stem)
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "diagram".to_string());
    let Some(target) = pick_export_path(&format!("{stem}-diagram.{extension}"), label, extension)
    else {
        return;
    };
    match fs::write(&target, &bytes) {
        Ok(()) => run_page_script(
            webview,
            &notice_toast_script(&format!("Saved {}", target.display())),
            "Failed to report a diagram export",
        ),
        Err(error) => report_file_action_failure(
            webview,
            &format!("Could not write {}: {error}", target.display()),
        ),
    }
}

/// Base64, undone. A PNG reaches the host as text because IPC carries a string, and this is the one place that turns it back into bytes. Whitespace is skipped and padding ends it; anything else is a refusal rather than a guess.
pub(super) fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(text.len() / 4 * 3);
    let mut carried: u32 = 0;
    let mut bits = 0u32;
    for byte in text.bytes() {
        let six = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b' ' | b'\t' | b'\r' | b'\n' => continue,
            _ => return None,
        };
        carried = (carried << 6) | u32::from(six);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((carried >> bits) as u8);
        }
    }
    Some(bytes)
}

/// Ask the library pane to re-read the folder it is showing.
///
/// Called after this app changes what is in a folder. The folder watcher notices too, but only for the one folder it watches and only after its debounce — so without this, doing something in the pane leaves the pane showing what was true before you did it.
pub(crate) fn refresh_library_folder(webview: Option<&WebView>) {
    run_page_script(
        webview,
        &library_refresh_script(),
        "Failed to refresh the library pane",
    );
}

/// Tell the person what went wrong, where they are looking. These are the failures they set in motion and are waiting on, and the terminal is not where they are.
pub(crate) fn report_file_action_failure(webview: Option<&WebView>, message: &str) {
    run_page_script(
        webview,
        &error_toast_script(message),
        "Failed to report a file action failure",
    );
}
