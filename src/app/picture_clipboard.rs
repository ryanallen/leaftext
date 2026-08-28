//! A picture on the system clipboard as pixels.
//!
//! The desktop page cannot finish this itself: it is not a secure context, so it has neither `navigator.clipboard` nor `ClipboardItem`. What crosses from the page is the PNG its own canvas wrote — one encoder for every kind of picture the reading view draws, rather than a second decoder here that would fail according to the picture's source format.

use super::*;

/// The PNG the page drew, put on the clipboard.
///
/// Off the loop: both helpers wait on a clipboard another program can be holding open, the way the file copy's does, so the window never stops for it.
pub(crate) fn copy(proxy: &EventLoopProxy<UserEvent>, data: String) {
    off_loop(proxy, move || UserEvent::PictureClipboardDone {
        error: copy_png_to_clipboard(&data)
            .err()
            .map(|error| format!("Failed to copy a picture to the clipboard: {error}")),
    });
}

/// Decode, write, hand over, clean up — in that order, which is what keeps a payload that is not a picture from leaving a file behind.
fn copy_png_to_clipboard(data: &str) -> io::Result<()> {
    let png = picture_bytes(data)?;
    let scratch = ScratchPicture::written(&png)?;
    let status = clipboard_helper(scratch.path()).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("the clipboard helper exited with status {status}"),
        ))
    }
}

/// The PNG the page sent, as bytes. On its own and first, so a payload that is not base64 is refused before anything is written.
pub(super) fn picture_bytes(data: &str) -> io::Result<Vec<u8>> {
    let png = decode_base64(data).filter(|bytes| !bytes.is_empty());
    png.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "the picture did not arrive as base64",
        )
    })
}

/// How many scratch pictures this copy of the app has made, so two copies made in the same millisecond cannot land on one name.
static SCRATCH_SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// One scratch PNG of this copy's own, gone when it goes out of scope.
///
/// A file rather than a value handed straight to the helper: both platforms read a picture from a path, and a picture is far too big to travel as a command line or an environment value. It is removed after the helper returns whether that helper worked or failed, so nothing of the reader's document is left in the temporary folder.
pub(super) struct ScratchPicture {
    path: PathBuf,
}

impl ScratchPicture {
    pub(super) fn written(png: &[u8]) -> io::Result<Self> {
        let serial = SCRATCH_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "leaftext-clipboard-{}-{serial}.png",
            std::process::id()
        ));
        // Created rather than opened, so this can never write over a file already sitting under the name.
        let mut file = fs::File::create_new(&path)?;
        io::Write::write_all(&mut file, png)?;
        Ok(Self { path })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ScratchPicture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// The platform's own clipboard helper, built for one scratch PNG and not yet run.
pub(super) fn clipboard_helper(picture: &Path) -> Command {
    #[cfg(target_os = "windows")]
    {
        // The same hidden STA PowerShell the file copy uses: the clipboard needs STA, and `SetDataObject(_, $true)` flushes so the picture survives the helper exiting. `FromFile` holds the file open, so it is let go before this process removes it. The path travels as an environment value to keep it out of the quoting.
        const SCRIPT: &str = "Add-Type -AssemblyName System.Windows.Forms;\
            Add-Type -AssemblyName System.Drawing;\
            $picture = [System.Drawing.Image]::FromFile($env:LEAF_CLIP_PICTURE);\
            $data = New-Object System.Windows.Forms.DataObject;\
            $data.SetImage($picture);\
            [System.Windows.Forms.Clipboard]::SetDataObject($data, $true);\
            $picture.Dispose()";
        use std::os::windows::process::CommandExt;
        let mut helper = Command::new("powershell");
        helper
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
            .env("LEAF_CLIP_PICTURE", picture)
            // CREATE_NO_WINDOW keeps the helper from flashing a console window.
            .creation_flags(0x0800_0000);
        helper
    }

    #[cfg(target_os = "macos")]
    {
        // The pasteboard takes the bytes under the PNG type, which is what makes this a picture another program pastes rather than a file it links to.
        let escaped = picture
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let mut helper = Command::new("osascript");
        helper.arg("-e").arg(format!(
            "set the clipboard to (read (POSIX file \"{escaped}\") as «class PNGf»)"
        ));
        helper
    }
}
