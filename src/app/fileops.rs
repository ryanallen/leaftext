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
///
/// Both platforms wait on their helper, so a clipboard another program is holding open comes back as an error rather than a copy that quietly never happened. That wait is why the caller runs this off the event loop.
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
        let status = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
            .env("LEAF_CLIP_PATH", path)
            .env("LEAF_CLIP_EFFECT", if cut { "2" } else { "5" })
            .creation_flags(0x0800_0000)
            .status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("the clipboard helper exited with status {status}"),
            ))
        };
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

/// Move a file to the OS trash / Recycle Bin (reversible), and say where it went.
///
/// The answer is `None` on Windows, where the bin is a namespace rather than a place and the original path is enough to find the item again. Whatever comes back is what `restore_from_trash` has to be handed.
pub(crate) fn delete_to_trash(path: &Path) -> Result<Option<PathBuf>, String> {
    platform::move_to_trash(path)
}

/// Put a file back where it was deleted from. `trashed` is whatever `delete_to_trash` answered.
pub(crate) fn restore_from_trash(original: &Path, trashed: Option<&Path>) -> Result<(), String> {
    platform::restore_from_trash(original, trashed)
}

/// The line sent to Finder for Get Info. `POSIX file` alone builds a specifier Finder need not accept as one of its own items, so it is coerced to an alias; `activate` puts the window Finder opens in front of ours instead of behind it.
// Called only on macOS, and `warnings = "deny"` fails every other build on an unused function.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn finder_information_window_script(path: &Path) -> String {
    // Backslashes first: escaping the quotes first would then double the backslashes they were given.
    let escaped = path
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    format!(
        "tell application \"Finder\"\n\tactivate\n\topen information window of (POSIX file \"{escaped}\" as alias)\nend tell"
    )
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
        // Output rather than status: Finder's own refusal is on stderr, and an exit code alone says nothing about why.
        let run = Command::new("osascript")
            .arg("-e")
            .arg(finder_information_window_script(path))
            .output()?;
        return if run.status.success() {
            Ok(())
        } else {
            let complaint = String::from_utf8_lossy(&run.stderr);
            let complaint = complaint.trim();
            Err(io::Error::new(
                io::ErrorKind::Other,
                if complaint.is_empty() {
                    format!("osascript exited with status {}", run.status)
                } else {
                    format!("Finder refused: {complaint}")
                },
            ))
        };
    }
}

/// Write the page as it stands out as a file of its own, asking where it goes first.
///
/// No print panel on either desktop. The reader asked for a file, not a printer to choose, so the chooser is the app's own two rows and the only question after it is where the file goes. What makes the file the whole document in its theme, rather than one screen of app frame, is the stylesheet's `leaf-paper` class, which the page raises before it sends this and which is why the page can measure the sheet it is about to ask for.
///
/// One continuous page rather than a document chopped across sheets: the page carries its own size here, so the sheet is made as tall as the document is.
///
/// Nothing about the open document changes. The file is written beside it.
pub(crate) fn export_page_pdf(
    webview: Option<&WebView>,
    document: Option<&Path>,
    format: &str,
    width: f64,
    height: f64,
) {
    let Some(page) = webview else { return };
    // The page held its appearance the moment it sent this, so the render's own light color scheme could not repaint the app underneath it. Released whichever way this goes, canceling included.
    let release = |page| {
        run_page_script(
            Some(page),
            "window.leafHoldAppearance && window.leafHoldAppearance(false);",
            "Failed to let the page follow the system theme again",
        )
    };
    let (extension, filters): (&str, &[(&str, &[&str])]) = match format {
        "pdf" => ("pdf", &[("PDF document", &["pdf"])]),
        // Not a row the chooser offers, so not a file anybody asked for.
        _ => {
            release(page);
            return;
        }
    };
    let stem = document
        .and_then(Path::file_stem)
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "document".to_string());
    let Some(target) =
        pick_export_path_titled("Save as PDF", &format!("{stem}.{extension}"), filters)
    else {
        release(page);
        return;
    };
    let outcome = write_page_pdf(page, &target, width, height);
    release(page);
    match outcome {
        Ok(()) => run_page_script(
            Some(page),
            &file_written_notice_script(&target.display().to_string()),
            "Failed to report a page export",
        ),
        Err(error) => report_file_action_failure(
            Some(page),
            &format!("That file could not be written. {error}"),
        ),
    }
}

/// The same render with the destination already chosen, and nothing said on screen about it.
///
/// What the ask pipe's `export` runs. The dialog above is the reason nothing here could ever read one of these files, and reading one is the only way to know how tall the sheet came out against how tall the page said the document was. It holds the appearance across the render the way the button's own press does, so the file carries the theme on screen rather than the light one a render emulates.
pub(crate) fn write_page_pdf_at(
    webview: Option<&WebView>,
    target: &Path,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let Some(page) = webview else {
        return Err("there is no page to render".to_string());
    };
    run_page_script(
        Some(page),
        "window.leafHoldAppearance && window.leafHoldAppearance(true);",
        "Failed to hold the page's appearance for an export",
    );
    let outcome = write_page_pdf(page, target, width, height);
    run_page_script(
        Some(page),
        "window.leafHoldAppearance && window.leafHoldAppearance(false);",
        "Failed to let the page follow the system theme again",
    );
    outcome
}

/// A CSS pixel is a ninety-sixth of an inch by definition, which is the only conversion between what the page measured and what a page size is written in.
const CSS_PIXELS_PER_INCH: f64 = 96.0;

/// Four pixels of slack under the last line, so a sheet is never a fraction shorter than what is laid out on it. A fraction short is not a fraction of blank paper — it is a whole second page with almost nothing on it.
const HAIR_OF_PAPER: f64 = 4.0;

/// How long a side of a PDF page can be. The format's own ceiling rather than anything chosen here, so a document taller than this cannot be one continuous page whatever the app asks for.
const LONGEST_PAGE_INCHES: f64 = 200.0;

/// The height of each sheet for a document `inches` tall: its own height where that fits on one page, and an equal share of it where it does not.
///
/// Cut at the ceiling instead and a document a little past it is one full sheet followed by a mostly blank one, which is the blank paper a reader meets and cannot explain. Divided, every sheet is full and the last one ends at the last line.
///
/// Both desktops ask it. A Mac writes the answer as points and Windows as inches, which is the only difference between them.
pub(super) fn sheet_inches(inches: f64) -> f64 {
    let sheets = (inches / LONGEST_PAGE_INCHES).ceil().max(1.0);
    // Rounded up to the hundredth the page size is written in. Rounded down instead, a sheet comes out a fraction of a pixel shorter than what is on it, and that fraction is a second, nearly empty page — which is most of what a reader sees as blank paper.
    let sheet = (inches / sheets * 100.0).ceil() / 100.0;
    sheet.clamp(1.0, LONGEST_PAGE_INCHES)
}

/// Render the open page to a PDF at `target`, with no panel and on one continuous page.
///
/// WebView2 has the call itself, off a later revision of its own interface, and `wry` hands back the raw one to ask for it. It renders asynchronously while the message loop is pumped, which is the same shape as the file dialog above: this thread waits, and the window stays alive.
///
/// The page size is the document's own, so nothing is cut across a sheet boundary. The height is taken as the page gave it, with a hair added against rounding and nothing more: a proportional allowance was tried and on a document twenty screens tall it is most of a sheet of white below the last line.
#[cfg(target_os = "windows")]
fn write_page_pdf(page: &WebView, target: &Path, width: f64, height: f64) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};
    use wry::WebViewExtWindows;

    let printer = page
        .webview()
        .cast::<ICoreWebView2_7>()
        .map_err(|_| "This copy of the web view runtime cannot write a PDF.".to_string())?;
    let settings = page
        .environment()
        .cast::<ICoreWebView2Environment6>()
        .ok()
        .and_then(|environment| unsafe { environment.CreatePrintSettings() }.ok());
    if let Some(settings) = settings.as_ref() {
        let inches = |pixels: f64| (pixels / CSS_PIXELS_PER_INCH).clamp(1.0, LONGEST_PAGE_INCHES);
        unsafe {
            settings.SetPageWidth(inches(width)).ok();
            settings
                .SetPageHeight(sheet_inches((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH))
                .ok();
            // One to one, said out loud. Left alone, the renderer lays the page out at its own width and shrinks the result to fit the sheet — which is how a sheet sized for the document ends up a fifth of it in blank paper.
            settings.SetScaleFactor(1.0).ok();
            settings.SetMarginTop(0.0).ok();
            settings.SetMarginBottom(0.0).ok();
            settings.SetMarginLeft(0.0).ok();
            settings.SetMarginRight(0.0).ok();
            // The theme is a painted background, and a renderer leaves those out unless it is told. The stylesheet forces the colors as well; both together are what keep a dark theme dark.
            settings.SetShouldPrintBackgrounds(true).ok();
            // A date, a title and a page number in somebody else's font, over a page that is the document and nothing else.
            settings.SetShouldPrintHeaderAndFooter(false).ok();
        }
    }
    let path = HSTRING::from(target.as_os_str());
    let wrote = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let written = std::sync::Arc::clone(&wrote);
    PrintToPdfCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            Ok(printer.PrintToPdf(&path, settings.as_ref(), &handler)?)
        }),
        Box::new(move |error, ok| {
            error?;
            written.store(ok, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        }),
    )
    .map_err(|error| error.to_string())?;
    if wrote.load(std::sync::atomic::Ordering::Relaxed) {
        Ok(())
    } else {
        Err("The page could not be rendered.".to_string())
    }
}

/// The same render on a Mac, and the same file at the end of it: the web view's own print operation with both panels switched off, the sheet the page measured as the paper, and the path the reader already chose as where the job saves to.
///
/// A plain `print()` raises the panel: the helper behind it leaves both panels on and writes its margins into the app's session-wide print settings. So this builds an `NSPrintInfo` of its own, which costs nothing and changes nothing a later print reads.
///
/// A page size is written in points here and in inches on the Windows side: a point is a seventy-second of an inch against a CSS pixel's ninety-sixth. Same sheet, same arithmetic above, two units.
///
/// Nothing here can watch the operation finish, so the answer is read off the file rather than off the call. A saved growl then only ever names a path with bytes at it.
#[cfg(target_os = "macos")]
fn write_page_pdf(page: &WebView, target: &Path, width: f64, height: f64) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::{NSSize, NSString, NSURL};
    use wry::WebViewExtMacOS;

    /// A point is a seventy-second of an inch, which is what a Mac page size is written in.
    const POINTS_PER_INCH: f64 = 72.0;

    let inches = |pixels: f64| (pixels / CSS_PIXELS_PER_INCH).clamp(1.0, LONGEST_PAGE_INCHES);
    let sheet = sheet_inches((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH);
    let settings = NSPrintInfo::new();
    settings.setPaperSize(NSSize::new(
        inches(width) * POINTS_PER_INCH,
        sheet * POINTS_PER_INCH,
    ));
    settings.setTopMargin(0.0);
    settings.setBottomMargin(0.0);
    settings.setLeftMargin(0.0);
    settings.setRightMargin(0.0);
    // One to one, said out loud. Fitting shrinks the document onto the sheet, and the sheet is already the document's own size, so fitting is only ever blank paper under the last line.
    settings.setScalingFactor(1.0);
    let destination = NSURL::fileURLWithPath(&NSString::from_str(&target.to_string_lossy()));
    // The job saves rather than spools, and the file it saves to is the one the reader named in the dialog before any of this ran.
    unsafe {
        settings.setJobDisposition(NSPrintSaveJob);
        settings
            .dictionary()
            .setObject_forKey(&destination, ProtocolObject::from_ref(NSPrintJobSavingURL));
    }
    let operation = unsafe { page.webview().printOperationWithPrintInfo(&settings) };
    // The two sheets a reader is not asking for: a printer to choose, and a progress window over a render that is writing a file.
    operation.setShowsPrintPanel(false);
    operation.setShowsProgressPanel(false);
    let ran = operation.runOperation();
    let wrote = std::fs::metadata(target)
        .map(|file| file.len() > 0)
        .unwrap_or(false);
    if ran && wrote {
        Ok(())
    } else {
        Err("The page could not be rendered.".to_string())
    }
}

/// What one diagram export comes to: the bytes to write, or why there are none. Where the file goes was answered by the save window before any of this ran.
pub(super) enum DiagramExportFile {
    Write(Vec<u8>),
    /// The payload did not decode, so the file would be one nobody can open.
    Unreadable,
    /// Not a format the app offers, so not a file anyone asked for.
    Unoffered,
}

/// Every format a diagram can be written as: the words the save window shows, and the endings they name. Windows names a file with no ending off the first, so the order is load-bearing. `diagram_export_file` below reads the same table, which is why a format lives here and nowhere else.
pub(crate) const DIAGRAM_EXPORT_FORMATS: &[(&str, &[&str])] = &[
    ("Markdown", &["md"]),
    ("PNG image", &["png"]),
    ("WebP image", &["webp"]),
];

/// The words the save window shows for one of those endings.
fn diagram_export_label(extension: &str) -> Option<&'static str> {
    DIAGRAM_EXPORT_FORMATS
        .iter()
        .find(|(_, endings)| endings.contains(&extension))
        .map(|(label, _)| *label)
}

/// What a save window opens with: the rows it offers, and the name it suggests.
pub(crate) struct SaveWindowOffer {
    /// The label first, then the endings it permits — the order a filter is added in.
    pub(crate) filters: Vec<(&'static str, &'static [&'static str])>,
    pub(crate) name: String,
}

/// A save window's own arithmetic, with the window left outside so this much can be tested: every format it could offer, the one the reader has already picked, and the stem its suggested name is built on.
///
/// With no answer the window keeps every row and suggests the first format's ending. Windows draws those rows as a dropdown and asks there, so the window is the whole question. A Mac panel throws every label away and permits all the endings at once, so nothing there says what is about to be written — it is asked before the window opens and arrives here with the answer, leaving one row and a name already ending in it, which is the one ending that panel has to work from.
///
/// A format no row names leaves every row standing, so a window always offers something a reader can save.
pub(crate) fn save_window_offer(
    formats: &[(&'static str, &'static [&'static str])],
    chosen: Option<&str>,
    stem: &str,
) -> SaveWindowOffer {
    let picked = chosen.and_then(|wanted| {
        formats.iter().find(|(_, endings)| {
            endings
                .iter()
                .any(|ending| ending.eq_ignore_ascii_case(wanted))
        })
    });
    let filters: Vec<(&'static str, &'static [&'static str])> = match picked {
        Some(one) => vec![*one],
        None => formats.to_vec(),
    };
    let ending = filters
        .first()
        .and_then(|(_, endings)| endings.first().copied());
    let name = match ending {
        Some(ending) => format!("{stem}.{ending}"),
        None => stem.to_string(),
    };
    SaveWindowOffer { filters, name }
}

/// Turn what the page sent into the file it wants written.
///
/// Its own function because the write itself is a disk call into a path a native window answered with, so this is the whole of the decision a test can reach.
pub(super) fn diagram_export_file(
    format: &str,
    data: &str,
    width: u32,
    height: u32,
) -> DiagramExportFile {
    // Asked of the one table first, so a format the save window never offered cannot reach the encoder below.
    if diagram_export_label(format).is_none() {
        return DiagramExportFile::Unoffered;
    }
    let bytes = match format {
        "md" => return DiagramExportFile::Write(data.as_bytes().to_vec()),
        // The page sends pixels rather than a PNG, because on a real diagram ours writes 77 KB where the canvas's own PNG is 153 KB. See src/png.rs.
        "png" => decode_base64(data).and_then(|rgba| encode_rgba(&rgba, width, height)),
        // Already a finished file: the canvas writes the WebP itself, about half the PNG on the same drawing, and refuses a drawing too wide for the format before it sends one.
        "webp" => decode_base64(data),
        _ => return DiagramExportFile::Unoffered,
    };
    match bytes {
        Some(bytes) if !bytes.is_empty() => DiagramExportFile::Write(bytes),
        // A half-decoded picture is worse than none, so nothing is written.
        _ => DiagramExportFile::Unreadable,
    }
}

/// Write the flowchart sheet's diagram out as its own file. The page asked where it goes first and made the bytes for that answer; this puts them there and says how it went.
///
/// Nothing about the open document changes. An export is a file beside it.
pub(crate) fn export_diagram(
    webview: Option<&WebView>,
    format: &str,
    data: &str,
    target: &Path,
    width: u32,
    height: u32,
) {
    let bytes = match diagram_export_file(format, data, width, height) {
        DiagramExportFile::Write(bytes) => bytes,
        DiagramExportFile::Unreadable => {
            report_file_action_failure(
                webview,
                "That picture could not be read, so nothing was written.",
            );
            return;
        }
        DiagramExportFile::Unoffered => return,
    };
    match fs::write(target, &bytes) {
        Ok(()) => run_page_script(
            webview,
            &file_written_notice_script(&target.display().to_string()),
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

/// Say a file has gone to the bin, and offer it back. A delete the app never mentions leaves no moment in which to change your mind, which is what the message is for.
pub(crate) fn report_file_deleted(webview: Option<&WebView>, path: &Path) {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    run_page_script(
        webview,
        &file_deleted_script(&path.to_string_lossy(), &name),
        "Failed to report a delete",
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
