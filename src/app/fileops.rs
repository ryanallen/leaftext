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

/// Open the OS file manager with `path` selected: Explorer on Windows, Finder
/// on macOS.
pub(crate) fn reveal_in_file_manager(path: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // `explorer /select,<path>` highlights the file. Spawn rather than wait
        // (Explorer returns non-zero even on success). Explorer needs `/select,`
        // outside the quotes with only the path quoted, so build the arg verbatim
        // with `raw_arg`; the std escaper would quote the whole token and break it.
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

/// Put the file on the system clipboard for pasting into the OS file manager.
/// `cut` requests move semantics.
pub(crate) fn copy_file_to_clipboard(path: &Path, cut: bool) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // "Preferred DropEffect" 2 = move (cut), 5 = copy, read by the shell on
        // paste. SetDataObject(_, $true) flushes so it survives PowerShell
        // exiting; clipboard needs STA. Path/effect via env to avoid quoting.
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
        // macOS has no clipboard "cut"; both put the file on the pasteboard (the
        // move is the user's Cmd+Opt+V on paste).
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

/// Rename a file in place. The new name must be a bare file name: empty names,
/// path separators, and the dot entries are rejected so the action can never move
/// the file or escape its folder. Returns the new path.
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

/// Move a file to the OS trash / Recycle Bin (reversible).
pub(crate) fn delete_to_trash(path: &Path) -> Result<(), String> {
    platform::move_to_trash(path)
}

/// Open the OS file-properties view: the Properties dialog on Windows, Finder's
/// Get Info on macOS.
pub(crate) fn show_properties(path: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // The shell Properties verb is modal to the caller, so the helper must
        // linger for the dialog; best-effort. Path via env var.
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
