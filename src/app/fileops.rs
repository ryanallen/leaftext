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

/// Every format the page can be written as: the words the save window shows, and the endings they name. Windows names a file with no ending off the first, so the order is load-bearing, and `page_export_kind` below reads the same table — which is why a format lives here and nowhere else.
pub(crate) const PAGE_EXPORT_FORMATS: &[(&str, &[&str])] = &[
    ("PDF document", &["pdf"]),
    ("Web page", &["html", "htm"]),
    ("PNG picture", &["png"]),
    ("WebP picture", &["webp"]),
    ("JPEG picture", &["jpg", "jpeg"]),
];

/// The rows *this* platform writes, which is the table above with anything it cannot make taken out.
///
/// One table with a filter rather than a table per platform: the rows that differ are the picture ones, and which of those a platform writes is already answered next to the encoder that writes them. A second list would be the same question with two answers, which is the thing this file has one table to avoid.
pub(crate) fn page_export_rows() -> Vec<(&'static str, &'static [&'static str])> {
    PAGE_EXPORT_FORMATS
        .iter()
        .filter(|(_, endings)| {
            endings
                .iter()
                .any(|ending| page_export_kind(Path::new(&format!("a.{ending}"))).is_some())
        })
        .copied()
        .collect()
}

/// Every way the page can be written out as `window.__leafPageExports` — the words the save window shows, and the ending each row writes.
///
/// The page cannot keep a copy of this list. A Mac panel shows no format at all, so the page draws the menu instead, and it draws it on a Mac browser reading the published site as well — where every export ends in the browser's own print, so a row the page offers that its host cannot write hands that reader a printed PDF and calls it a picture. Each host says what it writes, and a page whose host says nothing offers the one row every host has.
///
/// The order is the table's, which is the order the save window offers them in, and it is load-bearing: Windows names a file with no ending off the first.
pub fn initial_page_exports_script() -> String {
    let rows: Vec<serde_json::Value> = page_export_rows()
        .iter()
        .map(|(label, endings)| {
            serde_json::json!({
                "label": label,
                "id": endings[0],
            })
        })
        .collect();
    format!("window.__leafPageExports = {};", serde_json::json!(rows))
}

/// Which of those a chosen name is asking for.
pub(crate) enum PageExportKind {
    /// Rendered by the web view's own print, so there are no bytes here to write.
    Printed,
    /// Written from the markup the page has already drawn, with its stylesheet and its pictures beside it.
    WebPage,
    /// Photographed by the web view's own engine, whole and past the fold, and written where the reader said. The simplest of the three: nothing is asked of the page.
    Picture,
}

/// The words the save window shows for one of those endings.
fn page_export_label(extension: &str) -> Option<&'static str> {
    PAGE_EXPORT_FORMATS
        .iter()
        .find(|(_, endings)| endings.contains(&extension))
        .map(|(label, _)| *label)
}

/// What the ending on a chosen name asks for. A reader may type one, and Windows keeps a typed ending where the chosen filter permits it, so every spelling a row offers is answered rather than only the one that names it.
pub(crate) fn page_export_kind(target: &Path) -> Option<PageExportKind> {
    let ending = target.extension()?.to_string_lossy().to_lowercase();
    match ending.as_str() {
        "pdf" => Some(PageExportKind::Printed),
        "html" | "htm" => Some(PageExportKind::WebPage),
        // Asked of the picture table rather than spelled again, so a row this platform cannot write is not a kind it claims to answer.
        _ => page_picture_format(&ending).map(|_| PageExportKind::Picture),
    }
}

/// Write the page as it stands out as a file of its own, asking where it goes first.
///
/// No print panel on either desktop. The reader asked for a file, not a printer to choose, so the chooser is the app's own rows and the only question after it is where the file goes. What makes a printed file the whole document in its theme, rather than one screen of app frame, is the stylesheet's `leaf-paper` class, which is raised around the render after the save window answers.
///
/// One continuous page rather than a document chopped across sheets: the page carries its own size here, so the sheet is made as tall as the document is.
///
/// A web page is the other row, and nothing on the print path can write markup — so that ending sends the ask back to the page, which holds the document it has already drawn and answers with `exportPageHtml`.
///
/// Nothing about the open document changes. The file is written beside it.
pub(crate) fn export_page(
    webview: Option<&WebView>,
    document: Option<&Path>,
    format: &str,
    scale: f64,
    width: f64,
    height: f64,
) {
    let Some(page) = webview else { return };
    // Each render holds the appearance after the save window answers, then releases it when the render ends.
    let release = |page| {
        run_page_script(
            Some(page),
            "window.leafHoldAppearance && window.leafHoldAppearance(false);",
            "Failed to let the page follow the system theme again",
        )
    };
    let stem = document
        .and_then(Path::file_stem)
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "document".to_string());
    // Empty where the reader has not been asked, which is Windows: that window draws the rows as a dropdown and asks there. A Mac panel shows no format at all, so the page asks first and the window is left the one row.
    let chosen = (!format.is_empty()).then_some(format);
    let offer = save_window_offer(&page_export_rows(), chosen, &stem);
    // With two rows a window titled after one of them is wrong half the time.
    let title = match chosen.and_then(page_export_label) {
        Some(label) => format!("Save as {label}"),
        None => "Export Page".to_string(),
    };
    let Some(target) = pick_export_path_titled(&title, &offer.name, &offer.filters) else {
        return;
    };
    match page_export_kind(&target) {
        Some(PageExportKind::Printed) => {
            let cover = ExportCover::raise(page).ok();
            run_page_script(
                Some(page),
                "window.leafHoldAppearance && window.leafHoldAppearance(true);",
                "Failed to hold the page's appearance for an export",
            );
            let outcome = write_page_pdf(page, &target, width, height);
            release(page);
            drop(cover);
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
        Some(PageExportKind::Picture) => {
            // The writer raises a hold of its own for the capture and drops it again, because the ask pipe reaches it with nothing held. The hold counts, so this arm still owes the one the page raised before it sent: a count that never reaches zero leaves the paper class on, and every control in the app hidden under it, the close button with them.
            let outcome = write_page_picture_at(webview, scale, &target, width, height);
            release(page);
            match outcome {
                Ok(_) => run_page_script(
                    Some(page),
                    &file_written_notice_script(&target.display().to_string()),
                    "Failed to report a page export",
                ),
                Err(why) => report_file_action_failure(Some(page), &why),
            }
        }
        Some(PageExportKind::WebPage) => {
            let cover = ExportCover::raise(page).ok();
            run_page_script(
                Some(page),
                &page_html_export_script(&target.display().to_string()),
                "Failed to ask the page for the document it has drawn",
            );
            drop(cover);
        }
        // Not a row the chooser offers, so not a file anybody asked for.
        None => {
            let names: Vec<&str> = page_export_rows().iter().map(|(label, _)| *label).collect();
            report_file_action_failure(
                Some(page),
                &format!(
                    "A page is written as {}. Nothing was written.",
                    names.join(", ")
                ),
            );
        }
    }
}

/// What one web-page export comes to: the document as the page drew it, the drawings' own stylesheet, and the theme it was drawn in.
pub(crate) struct PageHtmlExport {
    pub(crate) markup: String,
    pub(crate) sheet: String,
    pub(crate) theme: String,
    pub(crate) appearance: String,
    pub(crate) title: String,
}

/// Write the document out as a web page, with its stylesheet and its pictures in one folder beside it, and say on screen where it went.
///
/// Where the file goes was answered by the save window before the page was asked for any of this.
pub(crate) fn export_page_html(
    webview: Option<&WebView>,
    target: &Path,
    export: &PageHtmlExport,
    source_dir: Option<&Path>,
) {
    match write_exported_page(target, export, source_dir) {
        Ok(()) => run_page_script(
            webview,
            &file_written_notice_script(&target.display().to_string()),
            "Failed to report a page export",
        ),
        Err(error) => {
            report_file_action_failure(webview, &format!("That file could not be written. {error}"))
        }
    }
}

/// The page where the reader pointed, and one `assets` folder beside it holding the stylesheet and every picture.
///
/// Beside rather than inside a folder of its own, because that is the shape the picture export writes: the file where they said, its assets in one folder next to it. Two documents exported into one folder therefore share that folder, which is why a name already taken is written beside rather than over.
pub(crate) fn write_exported_page(
    target: &Path,
    export: &PageHtmlExport,
    source_dir: Option<&Path>,
) -> Result<(), String> {
    let folder = target
        .parent()
        .ok_or_else(|| "there is nowhere beside it to put its assets.".to_string())?;
    let assets = folder.join(EXPORTED_PAGE_ASSETS_FOLDER);
    fs::create_dir_all(&assets).map_err(|error| error.to_string())?;
    // The whole stylesheet, which is every theme's colors, the tokens, the icons and the reading rules — see `EXPORTED_PAGE_STYLESHEET` for why none of it is trimmed. The name carries the folder, so this is the one place the two are joined.
    fs::write(folder.join(EXPORTED_PAGE_STYLESHEET), reading_mode_css())
        .map_err(|error| error.to_string())?;
    // The rail, which is the one thing on this page that runs. On every export rather than only a long document: the reader handed it has no library pane, no outline and no tab strip whatever it holds.
    fs::write(
        folder.join(EXPORTED_PAGE_MINIMAP_SCRIPT),
        exported_page_minimap_script(),
    )
    .map_err(|error| error.to_string())?;
    let markup = copy_page_pictures(&export.markup, &assets, source_dir);
    // Only where there is an equation to spend them on: the stylesheet and its twenty faces come to 283,127 bytes, and the reading stylesheet carries no math rule at all. The page names them off the same reading of the markup, so what is copied and what is named can never disagree.
    if markup_has_math(&markup) {
        let faces = folder.join(EXPORTED_PAGE_MATH_FONTS_FOLDER);
        fs::create_dir_all(&faces).map_err(|error| error.to_string())?;
        fs::write(folder.join(EXPORTED_PAGE_MATH_STYLESHEET), KATEX_CSS)
            .map_err(|error| error.to_string())?;
        for (name, bytes) in KATEX_FONTS {
            fs::write(faces.join(name), bytes).map_err(|error| error.to_string())?;
        }
    }
    let page = exported_page_document(
        &export.theme,
        &export.appearance,
        &export.title,
        &export.sheet,
        &markup,
    );
    fs::write(target, page).map_err(|error| error.to_string())
}

/// Copy every picture the document draws into `assets`, and point the markup at the copies.
///
/// The page addresses a local picture on a scheme no browser can fetch, so every one is copied and re-addressed or the exported page is a page of broken pictures. One copy per file however many times the document draws it; a picture served over the network is left as it was, so the page still opens.
///
/// A picture whose file cannot be read is still named — the file the document asked for, in the folder beside the page — so the browser draws its own broken mark rather than nothing at all.
fn copy_page_pictures(markup: &str, assets: &Path, source_dir: Option<&Path>) -> String {
    let Some(source_dir) = source_dir else {
        return markup.to_string();
    };
    let mut written: HashMap<PathBuf, String> = HashMap::new();
    let mut out = String::with_capacity(markup.len());
    let mut rest = markup;
    while let Some(at) = rest.find("src=\"") {
        let (before, tail) = rest.split_at(at + 5);
        out.push_str(before);
        let Some(end) = tail.find('"') else {
            out.push_str(tail);
            return out;
        };
        let (address, tail) = tail.split_at(end);
        match exported_picture_address(address, assets, source_dir, &mut written) {
            Some(copied) => out.push_str(&copied),
            None => out.push_str(address),
        }
        rest = tail;
    }
    out.push_str(rest);
    out
}

/// Where one `src` should point in the written page, or nothing where it is not a picture off this machine.
///
/// The address arrives as it was written into an attribute, so its ampersands are entities and have to come back before the URL will parse. The epoch stamp on the end is a query, which the resolver never reads.
fn exported_picture_address(
    address: &str,
    assets: &Path,
    source_dir: &Path,
    written: &mut HashMap<PathBuf, String>,
) -> Option<String> {
    let uri = address.replace("&amp;", "&");
    let source = local_image_protocol_path(&uri, source_dir)?;
    if let Some(name) = written.get(&source) {
        return Some(exported_picture_url(name));
    }
    let (name, copy) = assets_name_for(assets, &source);
    if copy {
        // A file that is not there is still named: the browser draws its own broken mark, which says what an empty space cannot.
        let _ = fs::copy(&source, assets.join(&name));
    }
    let url = exported_picture_url(&name);
    written.insert(source, name);
    Some(url)
}

/// The name a picture takes in the `assets` folder, and whether its bytes still have to be written there.
///
/// Two documents exported into one folder is the ordinary case here rather than the odd one, so a name already there belongs to a page somebody exported earlier and is never written over. A name holding the very same file is this document's own earlier export, so it is addressed and nothing is written — otherwise exporting one page twice leaves a second copy of every picture, addressed by nothing.
///
/// The comparison walks every name the numbering would reach rather than only the plain one: a folder already holding another document's picture under that name is exactly the folder the numbering exists for, and comparing one name would send every export of this document to a fresh number for ever.
fn assets_name_for(assets: &Path, source: &Path) -> (String, bool) {
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "picture".to_string());
    let stem = source
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "picture".to_string());
    let ending = source
        .extension()
        .map(|ending| format!(".{}", ending.to_string_lossy()))
        .unwrap_or_default();
    // Read at the first name that is taken, and only once however many names are then walked.
    let mut bytes: Option<Option<Vec<u8>>> = None;
    // A ceiling rather than a loop with no end, set far past any folder a reader fills by hand.
    for number in 1..1000 {
        let candidate = if number == 1 {
            name.clone()
        } else {
            format!("{stem}-{number}{ending}")
        };
        let taken = assets.join(&candidate);
        if !taken.exists() {
            return (candidate, true);
        }
        // A source that cannot be read has no bytes to match, so the walk falls through to the first free name and the copy fails, which is what leaves the browser its own broken mark.
        let Some(source_bytes) = bytes.get_or_insert_with(|| fs::read(source).ok()).as_ref() else {
            continue;
        };
        // The length first, because two files of different length are different and that is a single ask of the folder.
        if taken.metadata().map(|there| there.len()).ok() == Some(source_bytes.len() as u64)
            && fs::read(&taken).ok().as_deref() == Some(source_bytes.as_slice())
        {
            return (candidate, false);
        }
    }
    (name, true)
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
    let cover = ExportCover::raise(page).ok();
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
    drop(cover);
    outcome
}

/// Write the page out as a picture at `target`, holding the appearance across the render the way the PDF's own writer does.
///
/// The ending on the path is the format, which is the row the reader picked in the save window — so this reads the same table that window built its rows from, and refuses an ending it does not hold rather than writing bytes under it.
///
/// The hold is what makes the picture the document rather than the app's frame: under it the surface goes static, uncontained and as tall as everything it holds, and every control is taken off. Released whichever way this goes.
pub(crate) fn write_page_picture_at(
    webview: Option<&WebView>,
    scale: f64,
    target: &Path,
    width: f64,
    height: f64,
) -> Result<PageShot, String> {
    let Some(page) = webview else {
        return Err("there is no page to photograph".to_string());
    };
    let cover = ExportCover::raise(page).ok();
    let ending = target
        .extension()
        .map(|ending| ending.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let format = page_picture_format(&ending)
        .ok_or_else(|| format!("a page is not written as .{ending}"))?;
    run_page_script(
        Some(page),
        "window.leafHoldAppearance && window.leafHoldAppearance(true);",
        "Failed to hold the page's appearance for an export",
    );
    let outcome = capture_page(page, scale, width, height, &format);
    run_page_script(
        Some(page),
        "window.leafHoldAppearance && window.leafHoldAppearance(false);",
        "Failed to let the page follow the system theme again",
    );
    drop(cover);
    let shot = outcome?;
    std::fs::write(target, &shot.bytes).map_err(|error| error.to_string())?;
    Ok(shot)
}

/// The same write, answered the way the ask pipe wants it: where it went, the pixels it came out at, and what it weighs.
///
/// Beside the writer rather than in the loop, because what a picture is worth saying about it is this file's to know.
pub(crate) fn page_picture_answer(
    webview: Option<&WebView>,
    scale: f64,
    target: &Path,
    width: f64,
    height: f64,
) -> Result<serde_json::Value, String> {
    let shot = write_page_picture_at(webview, scale, target, width, height)?;
    Ok(serde_json::json!({
        "wrote": target.display().to_string(),
        "width": shot.width,
        "height": shot.height,
        "bytes": shot.bytes.len(),
    }))
}

/// A CSS pixel is a ninety-sixth of an inch by definition, which is the only conversion between what the page measured and what a page size is written in.
const CSS_PIXELS_PER_INCH: f64 = 96.0;

/// Four pixels of slack under the last line, so a sheet is never a fraction shorter than what is laid out on it. A fraction short is not a fraction of blank paper — it is a whole second page with almost nothing on it.
const HAIR_OF_PAPER: f64 = 4.0;

/// How long a side of a PDF page can be. The format's own ceiling rather than anything chosen here, so a document taller than this cannot be one continuous page whatever the app asks for.
const LONGEST_PAGE_INCHES: f64 = 200.0;

/// The one page a document `inches` tall is written on: its own height at full size where the ceiling holds it, and the ceiling itself, with the whole document scaled down onto it, where it does not.
///
/// Dividing a taller document into equal sheets was tried, and drawings undid it: a drawing cannot be split across a cut the way text can, so every cut pushed the drawing under it whole onto the next sheet, each sheet ended short by one drawing, and the pushes added up to a fourth, nearly empty sheet under a three-sheet document. Scaled onto one page there is no cut for anything to straddle, and the page ends at the last line.
///
/// Both desktops ask it. A Mac writes the height as points and Windows as inches, which is the only difference between them.
pub(super) struct Paper {
    /// How tall the page is, in inches.
    pub(super) height: f64,
    /// How much the document is shrunk to fit it: one at full size, less past the ceiling.
    pub(super) scale: f64,
}

/// The smallest scale a renderer will print at; a document taller than that allows spills onto a second page rather than shrinking further.
const SMALLEST_PRINT_SCALE: f64 = 0.1;

pub(super) fn paper_for(inches: f64) -> Paper {
    let inches = inches.max(1.0);
    if inches <= LONGEST_PAGE_INCHES {
        // Rounded up to the hundredth the page size is written in. Rounded down instead, the page comes out a fraction of a pixel shorter than what is on it, and that fraction is a second, nearly empty page — which is most of what a reader sees as blank paper.
        let height = (inches * 100.0).ceil() / 100.0;
        return Paper {
            height: height.min(LONGEST_PAGE_INCHES),
            scale: 1.0,
        };
    }
    Paper {
        height: LONGEST_PAGE_INCHES,
        scale: (LONGEST_PAGE_INCHES / inches).max(SMALLEST_PRINT_SCALE),
    }
}

/// Render the open page to a PDF at `target`, with no panel and on one continuous page.
///
/// WebView2 has the call itself, off a later revision of its own interface, and `wry` hands back the raw one to ask for it. It renders asynchronously while the message loop is pumped, which is the same shape as the file dialog above: this thread waits, and the window stays alive.
///
/// The page size is the document's own, so nothing is cut across a sheet boundary. The height is taken as the page gave it, with a hair added against rounding and nothing more: a proportional allowance was tried and on a document twenty screens tall it is most of a sheet of white below the last line. Past the ceiling the document is scaled onto one page rather than cut, and the page width shrinks with it, so the render lays the page out at the width the page measured itself at.
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
        let paper = paper_for((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH);
        unsafe {
            settings.SetPageWidth(inches(width) * paper.scale).ok();
            settings.SetPageHeight(paper.height).ok();
            // Said out loud: one to one under the ceiling, and past it the one scale that fits the whole document on the page. Left alone, the renderer lays the page out at its own width and shrinks the result to fit the sheet — which is how a sheet sized for the document ends up a fifth of it in blank paper.
            settings.SetScaleFactor(paper.scale).ok();
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
    let paper = paper_for((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH);
    let settings = NSPrintInfo::new();
    settings.setPaperSize(NSSize::new(
        inches(width) * paper.scale * POINTS_PER_INCH,
        paper.height * POINTS_PER_INCH,
    ));
    settings.setTopMargin(0.0);
    settings.setBottomMargin(0.0);
    settings.setLeftMargin(0.0);
    settings.setRightMargin(0.0);
    // Said out loud: one to one under the ceiling, and past it the one scale that fits the whole document on the page. Fitting on its own shrinks the document onto a sheet that is already the document's own size, so it is only ever blank paper under the last line.
    settings.setScalingFactor(paper.scale);
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

/// One picture of the page, as the host took it: the finished file, and the pixels it covers.
///
/// The size is read off the file's own header rather than decoded. Nothing here decodes a picture — `src/png.rs` writes PNGs and never reads one — and nothing needs to: what a caller wants to know is whether a picture came back at all, and how big the one that did is.
pub(crate) struct PageShot {
    pub(crate) bytes: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl PageShot {
    /// A picture out of raw bytes, refused where the engine answered with nothing — which is how it says a format could not hold a page this size.
    pub(super) fn from_bytes(bytes: Vec<u8>) -> Result<Self, String> {
        let (width, height) =
            picture_pixel_size(&bytes).ok_or_else(|| PICTURE_TOO_BIG.to_string())?;
        Ok(PageShot {
            bytes,
            width,
            height,
        })
    }
}

/// What is said when a picture does not come back. The engine answers an empty file rather than a reason, and the only reason it ever does is a page past what the format can hold — WebP stops at 16,383 pixels a side, and a long document is taller than that.
pub(crate) const PICTURE_TOO_BIG: &str =
    "That picture is too big for this format. Nothing was written — save it as a PNG instead, which has no such limit.";

/// The quality a WebP page is written at. The same 82 the diagram export writes its pictures at, so two pictures out of one app are the same trade. Windows only, because that is the one platform whose engine writes the format at all.
#[cfg(target_os = "windows")]
const WEBP_QUALITY: u32 = 82;

/// The quality a JPEG page is written at. The 0.92 every other JPEG this app writes is written at, spelled the way each engine wants it: Windows takes a whole number out of a hundred and the Mac bitmap takes a fraction of one.
///
/// Named rather than left to whatever an engine defaults to. Measured in a running window, this web view's own default is this same number today — and a default is a number somebody else owns, which could move under an update with nothing in the tree recording that every file the app writes had moved with it.
const JPEG_QUALITY_HUNDREDTHS: u32 = 92;

/// How the web view's own engine is asked for one of the picture formats: the name it knows it by.
///
/// The name and nothing else, because a quality is one platform's business — the Windows engine takes one for WebP and the Mac bitmap takes none — and a field only one of them can read is a field the other has to be told to ignore.
///
/// Both encoders are the engine's rather than anything in this tree, which is why a picture costs no crate.
pub(crate) struct PictureFormat {
    pub(crate) engine_name: &'static str,
}

/// Which picture an ending asks the engine for, or nothing where it is not one this platform writes.
///
/// The endings here are the ones `PAGE_EXPORT_FORMATS` offers, and that table is built per platform for exactly this reason: a row the engine cannot write is a row the save window must not show.
pub(crate) fn page_picture_format(extension: &str) -> Option<PictureFormat> {
    match extension {
        "png" => Some(PictureFormat { engine_name: "png" }),
        #[cfg(target_os = "windows")]
        "webp" => Some(PictureFormat {
            engine_name: "webp",
        }),
        // Both spellings, because a reader may type either and Windows keeps a typed ending where the chosen row permits it. On both platforms, unlike the WebP row above: this one is the format that every engine writes, the Mac bitmap included.
        "jpg" | "jpeg" => Some(PictureFormat {
            engine_name: "jpeg",
        }),
        _ => None,
    }
}

/// How wide and tall a picture says it is, read off its own header.
///
/// A PNG opens with its signature and the `IHDR` chunk it is required to carry first: four bytes of length, the name, then the two sizes. A WebP is a RIFF file whose `VP8X` chunk carries both sizes as three little-endian bytes each, holding one less than the real value. A JPEG carries its two sizes in a frame header somewhere after a run of segments nobody here reads, so it is the one format that has to be walked. Anything else — a file with no bytes in it most of all — is not a picture, which is the answer an engine gives when a format cannot hold a page this size.
pub(super) fn picture_pixel_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() >= 4 && bytes[0] == 0xff && bytes[1] == 0xd8 {
        return jpeg_pixel_size(bytes);
    }
    if bytes.len() >= 24 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" && &bytes[12..16] == b"IHDR" {
        let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
        let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
        return (width > 0 && height > 0).then_some((width, height));
    }
    if bytes.len() >= 30 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        // The extended header, which is what an engine writes for anything but the simplest picture.
        if &bytes[12..16] == b"VP8X" {
            let three = |at: usize| {
                1 + u32::from(bytes[at])
                    + (u32::from(bytes[at + 1]) << 8)
                    + (u32::from(bytes[at + 2]) << 16)
            };
            return Some((three(24), three(27)));
        }
        // A picture short enough for the plain header arrived, which is the question this answers; a second parser for its two sizes would be read by nothing.
        return Some((0, 0));
    }
    None
}

/// A JPEG's two sizes, off the frame header it carries somewhere after its opening marker.
///
/// The other two formats above put their sizes at a fixed offset and this one does not: a JPEG is a chain of segments — the thumbnail, the color profile, the quantization tables — and the frame header naming the picture's size sits after however many of them the encoder wrote. So the chain is walked, reading each segment's own length and stepping over it, until a `SOF` marker turns up.
///
/// Every marker in `C0`–`CF` is a frame header except three that share the range and are not: the Huffman tables, the arithmetic conditioning, and one the specification reserves. Those three carry a length like any other segment and are stepped over.
///
/// A chain that runs off the end, or one whose segment claims a length shorter than the two bytes the length itself takes, is not a picture — which is the same answer as a file with no bytes in it, and the answer that tells a reader a format could not hold their page.
fn jpeg_pixel_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut at = 2;
    while at + 1 < bytes.len() {
        if bytes[at] != 0xff {
            return None;
        }
        let marker = bytes[at + 1];
        // A run of `ff` before a marker is padding an encoder is allowed to write, so only one of the pair is spent.
        if marker == 0xff {
            at += 1;
            continue;
        }
        at += 2;
        // The markers that stand alone: the two ends of the file, the restarts inside it, and the one-byte temporary.
        if marker == 0x01 || (0xd0..=0xd9).contains(&marker) {
            continue;
        }
        if at + 1 >= bytes.len() {
            return None;
        }
        let length = usize::from(u16::from_be_bytes([bytes[at], bytes[at + 1]]));
        if length < 2 {
            return None;
        }
        if (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
            // Precision, then the height and the width — in that order, which is the one place a JPEG puts them the other way round from every table in this file.
            if at + 6 >= bytes.len() {
                return None;
            }
            let height = u32::from(u16::from_be_bytes([bytes[at + 3], bytes[at + 4]]));
            let width = u32::from(u16::from_be_bytes([bytes[at + 5], bytes[at + 6]]));
            return (width > 0 && height > 0).then_some((width, height));
        }
        at += length;
    }
    None
}

/// Photograph the whole document as one picture, at the size the page measured its sheet at.
///
/// The engine behind this web view is Chromium, and its own screenshot takes the page beyond the fold — the whole document in one call, rather than a stack of screenfuls somebody has to join without a seam. `CallDevToolsProtocolMethod` is how a WebView2 is asked for it, and it sits on the plain `ICoreWebView2` `wry` hands back, the same handle the PDF render casts a later revision of. So this costs no crate, and both encoders are the engine's.
///
/// The clip is the sheet in CSS pixels and its scale takes the window's own back to one, so the picture comes out at the document's own size — the size the PDF row beside it writes, which is what makes the two rows describe the same document.
///
/// It renders asynchronously while the message loop is pumped, which is the shape the PDF render takes too: this thread waits, and the window stays alive.
#[cfg(target_os = "windows")]
pub(crate) fn capture_page(
    page: &WebView,
    scale: f64,
    width: f64,
    height: f64,
    format: &PictureFormat,
) -> Result<PageShot, String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::HSTRING;
    use wry::WebViewExtWindows;

    let view = page.webview();
    // The two lossy formats, asked for by name here rather than carried on the format: what a quality is spelled as is the engine's business, and this call's is a whole number out of a hundred where the other platform's is a fraction of one.
    let quality = match format.engine_name {
        "webp" => format!(",\"quality\":{WEBP_QUALITY}"),
        "jpeg" => format!(",\"quality\":{JPEG_QUALITY_HUNDREDTHS}"),
        _ => String::new(),
    };
    // The clip's own scale rides on the window's, so one over it is what brings a device pixel back to a CSS one.
    let asked = HSTRING::from(format!(
        "{{\"format\":\"{}\"{quality},\"captureBeyondViewport\":true,\
         \"clip\":{{\"x\":0,\"y\":0,\"width\":{width},\"height\":{height},\"scale\":{}}}}}",
        format.engine_name,
        1.0 / scale.max(0.01),
    ));
    let method = HSTRING::from("Page.captureScreenshot");
    let answered = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let writing = std::sync::Arc::clone(&answered);
    CallDevToolsProtocolMethodCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            Ok(view.CallDevToolsProtocolMethod(&method, &asked, &handler)?)
        }),
        Box::new(move |error, json| {
            error?;
            if let Ok(mut held) = writing.lock() {
                *held = json.to_string();
            }
            Ok(())
        }),
    )
    .map_err(|error| error.to_string())?;
    let json = answered.lock().map(|held| held.clone()).unwrap_or_default();
    let data = serde_json::from_str::<serde_json::Value>(&json)
        .ok()
        .and_then(|answer| {
            answer
                .get("data")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .ok_or_else(|| "The view could not be photographed.".to_string())?;
    let bytes = decode_base64(&data)
        .ok_or_else(|| "The picture came back unreadable, so nothing was written.".to_string())?;
    PageShot::from_bytes(bytes)
}

/// The same picture on a Mac, off the `WKWebView` `wry` hands back.
///
/// There is no DevTools protocol behind a WebKit view and its own snapshot stops at what the view can see, so the whole document comes through the one call that does take a rect past the fold: the PDF the view renders of itself, drawn back into a bitmap at the size that was asked for. `createPDFWithConfiguration:` is `objc2-web-kit`'s and the bitmap is `objc2-app-kit`'s, and both already compile into this binary through `wry` — so naming them buys the name and no code, which is the trade the print arm above makes too.
///
/// That bitmap writes PNG and does not write WebP, which is why `page_picture_format` offers the WebP row on Windows alone: a row the engine cannot write is a row the save window must not show.
///
/// It answers on a queue of its own, so this waits on a channel rather than pumping a loop, and gives up rather than waiting for ever — the window thread is the one waiting, and a render that never lands would otherwise take the window with it.
#[cfg(target_os = "macos")]
pub(crate) fn capture_page(
    page: &WebView,
    _scale: f64,
    width: f64,
    height: f64,
    format: &PictureFormat,
) -> Result<PageShot, String> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage,
        NSImageCompressionFactor,
    };
    use objc2_foundation::{NSData, NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
    use objc2_web_kit::WKPDFConfiguration;
    use std::sync::mpsc;
    use wry::WebViewExtMacOS;

    /// Long enough for a document of any length this app opens, short enough that a render which never lands does not take the window with it.
    const RENDER_WAIT: std::time::Duration = std::time::Duration::from_secs(60);

    // Asked before anything is rendered: this bitmap writes PNG and JPEG and not WebP, so a format it cannot make is refused rather than written under the wrong ending. `page_picture_format` offers this platform the same two rows, and reading it here is what keeps the two answers one answer.
    let kind = match format.engine_name {
        "png" => NSBitmapImageFileType::PNG,
        "jpeg" => NSBitmapImageFileType::JPEG,
        other => return Err(format!("a page is not written as a {other} here.")),
    };
    // Whether this format takes a quality at all. PNG is lossless and takes none, so its dictionary stays the empty one this call has always passed.
    let lossy = kind == NSBitmapImageFileType::JPEG;
    let main = MainThreadMarker::new()
        .ok_or_else(|| "a picture is rendered on the window's own thread".to_string())?;
    let view = page.webview();
    // The whole document rather than the visible view: this is the one Mac call that takes a rect past the fold, which is why the picture is drawn out of a sheet rather than out of a snapshot.
    let how = unsafe { WKPDFConfiguration::new(main) };
    unsafe {
        how.setRect(NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(width, height),
        ))
    };
    let (answered, answer) = mpsc::sync_channel::<Result<Vec<u8>, String>>(1);
    let handler = block2::RcBlock::new(move |sheet: *mut NSData, failure: *mut NSError| {
        if !failure.is_null() || sheet.is_null() {
            let _ = answered.try_send(Err("The view could not be photographed.".to_string()));
            return;
        }
        let sheet = unsafe { &*sheet };
        let picture = NSImage::initWithData(NSImage::alloc(), sheet).and_then(|drawn| {
            // The sheet is measured in points and the picture in CSS pixels, which on this path are the same number: the rect above was written in the size the page measured.
            drawn.setSize(NSSize::new(width, height));
            let tiff = drawn.TIFFRepresentation()?;
            let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)?;
            // What a quality is spelled as here: a fraction of one, where the Windows call takes a whole number out of a hundred. Built where it is spent rather than carried in, so nothing crosses into the block but the one flag.
            let how: Retained<NSDictionary<NSBitmapImageRepPropertyKey, AnyObject>> = if lossy {
                let factor = NSNumber::new_f64(f64::from(JPEG_QUALITY_HUNDREDTHS) / 100.0);
                let value: &AnyObject = &factor;
                NSDictionary::from_slices(&[unsafe { NSImageCompressionFactor }], &[value])
            } else {
                NSDictionary::new()
            };
            unsafe { bitmap.representationUsingType_properties(kind, &how) }
        });
        let _ = answered.try_send(
            picture
                .map(|bytes| bytes.to_vec())
                .ok_or_else(|| "The picture could not be read back.".to_string()),
        );
    });
    unsafe { view.createPDFWithConfiguration_completionHandler(Some(&how), &handler) };
    answer
        .recv_timeout(RENDER_WAIT)
        .map_err(|_| "The view did not answer with a picture.".to_string())?
        .and_then(PageShot::from_bytes)
}

/// What one diagram export comes to: the bytes to write, or why there are none. Where the file goes was answered by the save window before any of this ran.
pub(super) enum DiagramExportFile {
    Write(Vec<u8>),
    /// The payload did not decode, so the file would be one nobody can open.
    Unreadable,
    /// Not a format the app offers, so not a file anyone asked for.
    Unoffered,
    /// Written by printing a page rather than by encoding anything, so there are no bytes here to write. The one table still carries the row; this arm is what keeps a stray `exportDiagram` naming that ending from writing a file of raw bytes under it.
    Printed,
}

/// Every format a diagram can be written as: the words the save window shows, and the endings they name. Windows names a file with no ending off the first, so the order is load-bearing. `diagram_export_file` below reads the same table, which is why a format lives here and nowhere else — the PDF included, which is printed rather than encoded and answers `Printed` there.
///
/// Markdown asks `src/format.rs` for the spellings an export may write instead of naming them here. That is a shorter list than the app reads: `.mdc` opens as Markdown and is never written as one. The pictures are not formats it knows, so they stay written out.
pub(crate) const DIAGRAM_EXPORT_FORMATS: &[(&str, &[&str])] = &[
    ("Markdown", MARKDOWN_EXPORT_EXTENSIONS),
    ("PNG image", &["png"]),
    ("WebP image", &["webp"]),
    ("PDF document", &["pdf"]),
    ("JPEG image", &["jpg", "jpeg"]),
];

/// Every format a picture in a document can be written as: the words the save window shows, and the endings they name. Windows names a file with no ending off the first row, so PNG leads — a reader pressing Export on a picture wants a picture. The diagram's own table leads with Markdown, which makes this order a deliberate difference rather than a copy.
///
/// Markdown asks `src/format.rs` for the spellings an export may write the way the diagram table does, which is a shorter list than the app reads. The pictures are not formats it knows, so they stay written out.
///
/// The three pictures run together, JPEG under the two it is measured against: it is never the smaller file — the closest it comes to WebP is 1.4 times on a screenshot — so what its row wins is reach into a tool that takes a `.jpg` and nothing else.
pub(crate) const PICTURE_EXPORT_FORMATS: &[(&str, &[&str])] = &[
    ("PNG image", &["png"]),
    ("WebP image", &["webp"]),
    ("JPEG image", &["jpg", "jpeg"]),
    ("PDF document", &["pdf"]),
    ("Markdown", MARKDOWN_EXPORT_EXTENSIONS),
];

/// The folder a Markdown picture export puts the picture in, beside the document it writes.
pub(crate) const PICTURE_EXPORT_IMAGE_DIR: &str = "imgs";

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

/// One row a file window opens with: the words it shows, then the endings it permits.
pub(crate) type WindowFilter = (&'static str, Vec<&'static str>);

/// The row that reads as "anything", and only on Windows, where the rows are a dropdown and this one becomes the spec `*.*`. A Mac panel has no dropdown: it drops every label, pours all the endings into one permitted list, and matches a name's ending against it — so this row arrives there as an ending spelled `*` and permits nothing but a file actually named `note.*`.
fn all_files_row() -> WindowFilter {
    ("All files", vec!["*"])
}

/// What the Open window opens with. On a Mac, nothing at all: the app opens anything — a file whose ending it does not know renders as Markdown — so the honest permitted list is every file, and handing rfd no rows leaves the panel at its own default, which is exactly that. Windows keeps a row per format and the `All files` row above them all.
pub(crate) fn open_window_filters(on_a_mac: bool) -> Vec<WindowFilter> {
    if on_a_mac {
        return Vec::new();
    }
    let mut filters = vec![("Documents", all_document_extensions())];
    for format in DocumentFormat::ALL {
        filters.push((format.display_name(), format.extensions().to_vec()));
    }
    filters.push(all_files_row());
    filters
}

/// What the first save of a note with no file opens with: the rows `save_window_offer` decided, and the `All files` row on Windows only. This window keeps its rows on a Mac where Open drops them, because the panel appends its one permitted ending to a bare name — handing it none would take away the very format the reader was just asked for.
pub(crate) fn save_window_filters(offer: &SaveWindowOffer, on_a_mac: bool) -> Vec<WindowFilter> {
    let mut filters: Vec<WindowFilter> = offer
        .filters
        .iter()
        .map(|(label, endings)| (*label, endings.to_vec()))
        .collect();
    if !on_a_mac {
        // Last, so Windows names a bare file off the format above it rather than off this row.
        filters.push(all_files_row());
    }
    filters
}

/// What the Insert image window opens with: the endings the reading view draws, and the `All files` row on Windows only. Permitting every file on a Mac would be the same lie pointing the other way, since a picked `.zip` becomes the broken-image mark.
pub(crate) fn image_window_filters(on_a_mac: bool) -> Vec<WindowFilter> {
    let mut filters = vec![("Images", drawable_image_extensions())];
    if !on_a_mac {
        filters.push(all_files_row());
    }
    filters
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
    // Every spelling this window offers, asked of the one table: the row permits them all, so an arm naming one drops the rest through to a file nobody wrote and nothing said.
    if MARKDOWN_EXPORT_EXTENSIONS.contains(&format) {
        return DiagramExportFile::Write(data.as_bytes().to_vec());
    }
    let bytes = match format {
        // The page sends pixels rather than a PNG, because on a real diagram ours writes 77 KB where the canvas's own PNG is 153 KB. See src/png.rs.
        "png" => decode_base64(data).and_then(|rgba| encode_rgba(&rgba, width, height)),
        // Already a finished file: the canvas writes the WebP itself, about half the PNG on the same drawing, and refuses a drawing too wide for the format before it sends one.
        "webp" => decode_base64(data),
        // Already a finished file too, at a quality the page names rather than inherits, and refused before it is sent where the drawing is too wide for the format.
        "jpg" | "jpeg" => decode_base64(data),
        // Rendered by the host rather than encoded from anything the page sent, so this command is not the one that writes it — `print_diagram_pdf` is.
        "pdf" => return DiagramExportFile::Printed,
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
        // Nothing to write here, and nothing to say: the row is printed, and a message would be about a file the reader never asked this command for.
        DiagramExportFile::Printed => return,
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

/// Print one diagram onto a sheet of its own, at the path the save window already answered with.
///
/// The page put a freshly drawn copy of the drawing in its print container and raised `leaf-paper-diagram`, which takes everything else in the surface off the sheet — so this is the same render the page export runs, with one thing left standing on the page. The size is the drawing's own, measured in the page, which is why nothing here works one out.
///
/// The page is told the moment the render is over, however it went: the print state is the page with the reader's document taken off it, and a state left on is a window holding a bare drawing.
///
/// Nothing about the open document changes. The file is written beside it.
pub(crate) fn print_diagram_pdf(webview: Option<&WebView>, target: &Path, width: f64, height: f64) {
    let outcome = write_page_pdf_at(webview, target, width, height);
    run_page_script(
        webview,
        "window.leafDiagramPrinted && window.leafDiagramPrinted();",
        "Failed to give the page back to the reader after a diagram print",
    );
    match outcome {
        Ok(()) => run_page_script(
            webview,
            &file_written_notice_script(&target.display().to_string()),
            "Failed to report a diagram print",
        ),
        Err(error) => report_file_action_failure(
            webview,
            &format!("Could not write {}: {error}", target.display()),
        ),
    }
}

/// The name a copied picture takes in the `imgs` folder: its own, or a numbered one beside it where that name is already there. `taken` answers for one name, so the whole of the decision can be tested without a disk.
///
/// Beside rather than over, because an export that quietly replaced somebody's file is the one mistake here nobody can undo. Overwriting is the cheaper code and the worse fault.
pub(crate) fn free_picture_name(file_name: &str, taken: &dyn Fn(&str) -> bool) -> String {
    if !taken(file_name) {
        return file_name.to_string();
    }
    // The dot has to have something in front of it, or a dotfile would be numbered on its own name and lose it.
    let (stem, ending) = match file_name.rfind('.') {
        Some(at) if at > 0 => file_name.split_at(at),
        _ => (file_name, ""),
    };
    let mut number = 2u32;
    loop {
        let candidate = format!("{stem}-{number}{ending}");
        if !taken(&candidate) {
            return candidate;
        }
        number += 1;
    }
}

/// The words a picture carries, safe to sit inside `![...]`: a bracket of its own would close the label early, a backslash would escape whatever came next, and a line break would end the paragraph the picture is in.
pub(crate) fn markdown_alt_text(alt: &str) -> String {
    let mut written = String::with_capacity(alt.len());
    for letter in alt.chars() {
        match letter {
            '[' | ']' | '\\' => {
                written.push('\\');
                written.push(letter);
            }
            '\n' | '\r' => written.push(' '),
            _ => written.push(letter),
        }
    }
    written.trim().to_string()
}

/// What a Markdown picture export writes: one line, the picture and the words the note gave it.
pub(crate) fn picture_export_document(alt: &str, destination: &str) -> String {
    format!(
        "![{}]({destination})
",
        markdown_alt_text(alt)
    )
}

/// Write a picture out as a Markdown document with the picture beside it: the document at `target`, an `imgs` folder next to it, and the file copied in under its own name.
///
/// Two files and a folder, which no other export here writes. Nothing is converted, so this row works for every kind of picture the reading view draws.
///
/// Nothing about the open document changes. An export is a file beside it.
pub(crate) fn export_picture_markdown(
    webview: Option<&WebView>,
    target: &Path,
    source: &Path,
    alt: &str,
) {
    let Some(folder) = target.parent() else {
        report_file_action_failure(webview, "That picture had nowhere to be written.");
        return;
    };
    let images = folder.join(PICTURE_EXPORT_IMAGE_DIR);
    if let Err(error) = fs::create_dir_all(&images) {
        report_file_action_failure(
            webview,
            &format!("Could not make {}: {error}", images.display()),
        );
        return;
    }
    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "picture".to_string());
    let name = free_picture_name(&file_name, &|candidate| images.join(candidate).exists());
    let copy = images.join(&name);
    if let Err(error) = fs::copy(source, &copy) {
        report_file_action_failure(
            webview,
            &format!("Could not write {}: {error}", copy.display()),
        );
        return;
    }
    // Asked of the same function the Insert box asks, so a name holding a space or a bracket is wrapped the way CommonMark wants it.
    let destination = markdown_image_insert_destination(&copy, target);
    match fs::write(target, picture_export_document(alt, &destination)) {
        Ok(()) => run_page_script(
            webview,
            &file_written_notice_script(&target.display().to_string()),
            "Failed to report a picture export",
        ),
        Err(error) => report_file_action_failure(
            webview,
            &format!("Could not write {}: {error}", target.display()),
        ),
    }
}

/// Print one picture onto a sheet of its own, at the path the save window already answered with.
///
/// The page put a copy of the picture in its print container at that picture's own pixel size and raised `leaf-paper-picture`, which takes everything else in the surface off the sheet — so this is the same render the page export runs, with one picture left standing. A picture taller than the ceiling is scaled onto one page by `paper_for`, the way a long document already is.
///
/// The page is told the moment the render is over, however it went: a print state left on is a window holding a bare picture where the reader's document was.
///
/// Nothing about the open document changes. The file is written beside it.
pub(crate) fn print_picture_pdf(webview: Option<&WebView>, target: &Path, width: f64, height: f64) {
    let outcome = write_page_pdf_at(webview, target, width, height);
    run_page_script(
        webview,
        "window.leafPicturePrinted && window.leafPicturePrinted();",
        "Failed to give the page back to the reader after a picture print",
    );
    match outcome {
        Ok(()) => run_page_script(
            webview,
            &file_written_notice_script(&target.display().to_string()),
            "Failed to report a picture print",
        ),
        Err(error) => report_file_action_failure(
            webview,
            &format!("Could not write {}: {error}", target.display()),
        ),
    }
}

/// The words the save window shows for one of the picture endings.
fn picture_export_label(extension: &str) -> Option<&'static str> {
    PICTURE_EXPORT_FORMATS
        .iter()
        .find(|(_, endings)| endings.contains(&extension))
        .map(|(label, _)| *label)
}

/// Every spelling the row holding this ending permits.
///
/// The copy rule below asks this rather than comparing two endings as words: JPEG is written `jpg` and `jpeg`, so a `.jpeg` on disk asked for as a `.jpg` is the same picture in the same format and re-encoding it would lose quality to make a bigger file.
fn picture_export_endings(extension: &str) -> &'static [&'static str] {
    PICTURE_EXPORT_FORMATS
        .iter()
        .find(|(_, endings)| endings.contains(&extension))
        .map(|(_, endings)| *endings)
        .unwrap_or(&[])
}

/// Write a picture in the document out as a file of its own, in whichever row the reader picked.
///
/// Nothing about the open document changes. An export is a file beside it.
#[allow(clippy::too_many_arguments)]
pub(crate) fn export_picture(
    webview: Option<&WebView>,
    format: &str,
    source: &Path,
    target: &Path,
    alt: &str,
    data: &str,
) {
    // Asked of the one table first, so a format the save window never offered cannot reach a write below.
    if picture_export_label(format).is_none() {
        return;
    }
    // Every spelling this window offers, asked of the one table: the row permits them all, so an arm naming one drops the rest through to a file nobody wrote and nothing said.
    if MARKDOWN_EXPORT_EXTENSIONS.contains(&format) {
        export_picture_markdown(webview, target, source, alt);
        return;
    }
    // A PDF is rendered rather than encoded, so no bytes ever arrive here: `print_picture_pdf` is what writes that row, and falling through is what keeps a stray `exportPicture` naming that ending from writing raw bytes under it.
    if format == "pdf" {
        return;
    }
    // A source already in the format asked for is copied rather than re-encoded: the copy is smaller, lossless and exact, where a round trip through the page's canvas is none of the three. Measured on the one screenshot this tree has weighed, a canvas PNG came to 484 KB where the file on disk was 145 KB. Asked of the row rather than of the one word, so a `.jpeg` picked as a `.jpg` is the copy it is.
    if picture_export_endings(format).contains(&picture_source_ending(source).as_str()) {
        match fs::copy(source, target) {
            Ok(_) => run_page_script(
                webview,
                &file_written_notice_script(&target.display().to_string()),
                "Failed to report a picture export",
            ),
            Err(error) => report_file_action_failure(
                webview,
                &format!("Could not write {}: {error}", target.display()),
            ),
        }
        return;
    }
    // A finished file the page's own canvas wrote, for both rows. The host's PNG encoder writes every row unfiltered and reaches for a palette, both chosen because a diagram and a page of text are flat fill — a photograph is neither, and the pixels would cross as about twenty times the bytes of the file they came to.
    match decode_base64(data) {
        Some(bytes) if !bytes.is_empty() => match fs::write(target, &bytes) {
            Ok(()) => run_page_script(
                webview,
                &file_written_notice_script(&target.display().to_string()),
                "Failed to report a picture export",
            ),
            Err(error) => report_file_action_failure(
                webview,
                &format!("Could not write {}: {error}", target.display()),
            ),
        },
        // A half-decoded picture is worse than none, so nothing is written.
        _ => report_file_action_failure(
            webview,
            "That picture could not be read, so nothing was written.",
        ),
    }
}

/// The format a picture on disk is already in, spelled the way the export rows spell it. `jfif` is left alone: no row here names it, so a picture under that ending is re-encoded rather than copied.
fn picture_source_ending(source: &Path) -> String {
    source
        .extension()
        .map(|ending| ending.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
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
