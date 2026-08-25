//! Export and Save As: the picture, the diagram, the PDF and the exported page.

use super::*;

#[test]
fn an_exported_picture_is_decoded_exactly_or_not_at_all() {
    // A PNG reaches the host as base64 because IPC carries a string. The bytes are then written straight to a file, so a decoder that is off by one pads out a picture nobody can open — and a wrong byte is invisible until then.
    let round_trip = |bytes: &[u8], encoded: &str| {
        assert_eq!(
            decode_base64(encoded).as_deref(),
            Some(bytes),
            "{encoded} did not come back as its bytes"
        );
    };

    round_trip(b"", "");
    round_trip(b"f", "Zg==");
    round_trip(b"fo", "Zm8=");
    round_trip(b"foo", "Zm9v");
    round_trip(b"foob", "Zm9vYg==");
    round_trip(b"fooba", "Zm9vYmE=");
    round_trip(b"foobar", "Zm9vYmFy");
    // The first eight bytes of every PNG, which is what the page will send.
    round_trip(
        &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        "iVBORw0KGgo=",
    );
    // Both of the last two alphabet characters, and every bit set.
    round_trip(&[0xff, 0xff, 0xff], "////");
    round_trip(&[0xfb, 0xff, 0xfe], "+//+");
    // A data URL split across lines is still the same picture.
    round_trip(b"foobar", "Zm9v\nYmFy\r\n");

    // Anything that is not base64 is refused whole rather than half-decoded: a truncated picture written to disk looks like a file and is not one.
    assert_eq!(decode_base64("data:image/png;base64,Zm9v"), None);
    assert_eq!(decode_base64("Zm9v*"), None);
    assert_eq!(decode_base64("Zm9-v"), None);
}

#[test]
fn a_diagram_export_writes_the_page_s_own_bytes_or_none_at_all() {
    // The write itself is a disk call into a path a native window answered with, so this is the whole of the decision. No two kinds of row in the five reach the file the same way — the page sends the text for Markdown, pixels for a PNG, and a finished file for a WebP and a JPEG, while the PDF row is printed rather than encoded and never arrives here with bytes at all — and a payload that does not decode has to end as nothing rather than as a file that will not open.
    let written = |format: &str, data: &str, width: u32, height: u32| match diagram_export_file(
        format, data, width, height,
    ) {
        DiagramExportFile::Write(bytes) => Some(bytes),
        _ => None,
    };
    let refused = |format: &str, data: &str| {
        matches!(
            diagram_export_file(format, data, 1, 1),
            DiagramExportFile::Unreadable
        )
    };

    let text = "```mermaid
flowchart TD
  A --> B
```
";
    // Every spelling `src/format.rs` names for Markdown, not just the one the page sends: the row permits them all, so any of them reaching here has to write the text rather than fall through to nothing.
    for spelling in DocumentFormat::Markdown.extensions() {
        assert_eq!(
            written(spelling, text, 0, 0),
            Some(text.as_bytes().to_vec()),
            "a diagram saved as {spelling} did not go out as the text the page sent"
        );
    }

    // Base64 of one opaque white pixel, which is what the page sends for a PNG.
    let bytes = written("png", "/////w==", 1, 1).expect("a pixel encodes");
    assert_eq!(
        &bytes[..8],
        &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        "the host encoded the pixels rather than writing them out raw"
    );

    // A WebP is already a file when it arrives: the canvas wrote it, so the bytes go out exactly as they came in.
    assert_eq!(
        written("webp", "UklGRg==", 0, 0),
        Some(b"RIFF".to_vec()),
        "the finished file was re-encoded instead of written straight out"
    );

    // Both spellings of the JPEG row reach the same arm, because Windows keeps a typed `.jpeg` where the chosen filter permits it. A JPEG arrives finished off the canvas, exactly as a WebP does.
    for spelling in ["jpg", "jpeg"] {
        assert_eq!(
            written(spelling, "/9j/4AAQ", 0, 0),
            Some(vec![0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
            "{spelling} was re-encoded instead of written straight out, or is a spelling the host never heard of"
        );
    }

    assert!(refused("jpg", "not base64!"), "a broken JPEG payload");
    assert!(refused("webp", "not base64!"), "a broken WebP payload");
    assert!(refused("png", "not base64!"), "a broken picture payload");
    assert!(refused("webp", ""), "an empty file is not a file");
    assert!(
        matches!(
            diagram_export_file("svg", "anything", 1, 1),
            DiagramExportFile::Unoffered
        ),
        "a format the save window does not offer is nothing anybody asked for"
    );

    // A PDF is rendered by the host, so the one command that carries bytes has none to carry for it. The row stays in the table and this arm is what stops those bytes reaching a file: `print_diagram_pdf` is what writes one.
    assert!(
        matches!(
            diagram_export_file("pdf", "anything", 1, 1),
            DiagramExportFile::Printed
        ),
        "a PDF was treated as bytes the page sent, which writes a .pdf full of something else"
    );

    // One table, so the window and the encoder cannot drift: every ending the window offers is one the host writes, and Markdown is first because Windows names a file with no ending off the first filter.
    assert_eq!(
        DIAGRAM_EXPORT_FORMATS,
        &[
            ("Markdown", DocumentFormat::Markdown.extensions()),
            ("PNG image", &["png"][..]),
            ("WebP image", &["webp"][..]),
            ("PDF document", &["pdf"][..]),
            ("JPEG image", &["jpg", "jpeg"][..])
        ],
        "the save window offers a format the host does not write, or lists them in an order that names a bare file wrongly"
    );
    for (_, endings) in DIAGRAM_EXPORT_FORMATS {
        for extension in *endings {
            assert!(
                !matches!(
                    diagram_export_file(extension, "", 1, 1),
                    DiagramExportFile::Unoffered
                ),
                "the window offers {extension} and the host has never heard of it"
            );
        }
    }
}

/// A save window opens with rows and a suggested name, and the window itself cannot be reached from here — so this is the whole of what is decided before one opens.
///
/// The two answers are two platforms. Windows is asked nothing beforehand and keeps every row as its dropdown. A Mac shows no format at all, so the page asks first and the answer arrives here: one row, and a name already ending in it.
#[test]
fn save_window_offers_one_format_once_the_reader_has_picked_one() {
    let unasked = save_window_offer(DIAGRAM_EXPORT_FORMATS, None, "README-diagram");
    assert_eq!(
        unasked.filters,
        DIAGRAM_EXPORT_FORMATS.to_vec(),
        "a window nobody was asked ahead of dropped a format Windows offers in its dropdown"
    );
    assert_eq!(
        unasked.name, "README-diagram.md",
        "the name a window suggests stopped ending in the first format's own ending"
    );

    let picked = save_window_offer(DIAGRAM_EXPORT_FORMATS, Some("webp"), "README-diagram");
    assert_eq!(
        picked.filters,
        vec![("WebP image", &["webp"][..])],
        "a Mac panel was left more than the one ending the reader picked, so it says nothing again"
    );
    assert_eq!(
        picked.name, "README-diagram.webp",
        "the reader picked WebP and the name still says something else"
    );

    // Every spelling of Markdown names the row, asked of the shipped table rather than one written here, and the name still comes out under the canonical one — the ending the panel appends is the first permitted type, not whatever was asked with.
    for spelling in DocumentFormat::Markdown.extensions() {
        for asked in [spelling.to_string(), spelling.to_ascii_uppercase()] {
            let spelled = save_window_offer(DIAGRAM_EXPORT_FORMATS, Some(&asked), "Untitled");
            assert_eq!(
                spelled.filters,
                vec![("Markdown", DocumentFormat::Markdown.extensions())],
                "a Mac panel asked with {asked} was left more than the one row the reader picked"
            );
            assert_eq!(
                spelled.name, "Untitled.md",
                "the reader picked Markdown as {asked} and the suggested name does not end in the row's first spelling"
            );
        }
    }

    // The PDF row is offered the same way the other three are, though the host renders it rather than encoding anything: what the window asks and what writes the file are separate questions.
    let printed = save_window_offer(DIAGRAM_EXPORT_FORMATS, Some("pdf"), "README-diagram");
    assert_eq!(
        printed.filters,
        vec![("PDF document", &["pdf"][..])],
        "a Mac panel was left more than the one ending the reader picked, so it says nothing again"
    );
    assert_eq!(
        printed.name, "README-diagram.pdf",
        "the reader picked PDF and the name still says something else"
    );

    // The JPEG row permits two spellings and names its file off the first, so a reader who picked it on a Mac is handed `.jpg` however the row was asked for.
    for asked in ["jpg", "jpeg", "JPEG"] {
        let jpeg = save_window_offer(DIAGRAM_EXPORT_FORMATS, Some(asked), "README-diagram");
        assert_eq!(
            jpeg.filters,
            vec![("JPEG image", &["jpg", "jpeg"][..])],
            "a Mac panel asked with {asked} was left more than the one row the reader picked"
        );
        assert_eq!(
            jpeg.name, "README-diagram.jpg",
            "the reader picked JPEG and the suggested name does not end in the row's first spelling"
        );
    }

    // Nothing the table names, so every row stands: a window that offered nothing is one a reader cannot save from at all.
    let unknown = save_window_offer(DIAGRAM_EXPORT_FORMATS, Some("svg"), "README-diagram");
    assert_eq!(unknown.filters, DIAGRAM_EXPORT_FORMATS.to_vec());
    assert_eq!(unknown.name, "README-diagram.md");
    assert_eq!(
        unknown.filters.len(),
        5,
        "the window stopped offering every format the table names"
    );
}

/// What the three windows carrying an `All files` row open with, on both platforms, since neither window can be opened from a test.
///
/// A Mac panel throws every label away and permits only the endings it is handed, so that row arrives there as an ending spelled `*` and lets through nothing but a file actually named `note.*`. Each window therefore says the one thing it can honestly say instead.
#[test]
fn each_window_offers_what_its_platform_can_honestly_read() {
    // Open can hand back anything, because an ending the app does not know renders as Markdown. So a Mac gets no rows at all and rfd never calls the setter, which leaves the panel permitting every file.
    assert!(
        open_window_filters(true).is_empty(),
        "Open on a Mac offered a row again, which is the panel permitting only what that row names"
    );

    // The first save of a note with no file keeps its one row on a Mac, because that is the ending the panel appends to a bare name — the reader was asked which format before the window opened.
    let readable: Vec<(&'static str, &'static [&'static str])> = DocumentFormat::ALL
        .iter()
        .map(|format| (format.display_name(), format.extensions()))
        .collect();
    let offer = save_window_offer(&readable, Some("yaml"), "Untitled");
    assert_eq!(offer.name, "Untitled.yaml");
    assert_eq!(
        save_window_filters(&offer, true),
        vec![("YAML", vec!["yaml", "yml"])],
        "the Mac save window lost the format the reader picked, or kept a row that permits no real file"
    );

    // Insert image keeps its endings on a Mac, off the one table the reading view draws from: permitting everything there would be the same lie the other way round, since a picked file the view cannot draw becomes the broken-image mark.
    assert_eq!(
        image_window_filters(true),
        vec![("Images", drawable_image_extensions())],
        "the Mac Insert image window offers something other than exactly what the reading view draws"
    );

    // Windows draws the rows as a dropdown, where `All files` becomes the spec `*.*` and does what it says. All three keep it, and it goes last so a bare name is never given its ending.
    for (window, filters) in [
        ("Open", open_window_filters(false)),
        ("Save", save_window_filters(&offer, false)),
        ("Insert image", image_window_filters(false)),
    ] {
        assert_eq!(
            filters.last(),
            Some(&("All files", vec!["*"])),
            "{window} on Windows lost the row a reader presses to see everything, or stopped keeping it last"
        );
    }
    assert_eq!(
        open_window_filters(false).first(),
        Some(&("Documents", all_document_extensions())),
        "Open on Windows stopped leading with every readable ending at once"
    );

    // The diagram export window never carried the row and must not gain one: it offers the formats a diagram can be written as and nothing else, on both platforms.
    for (_, endings) in DIAGRAM_EXPORT_FORMATS {
        assert!(
            !endings.contains(&"*"),
            "the diagram export window gained a row that permits no real file on a Mac"
        );
    }
}

/// The one file nothing here could ever read. The Export button opens a save dialog and no session can answer one, so a sheet had never been measured against the height the page said the document needed. This is that ask: a destination on the wire, no dialog, and a longer wait than every other ask because the loop is inside the render.
#[test]
fn the_export_ask_carries_a_destination_and_the_size_the_page_measured() {
    let ask = serde_json::from_str::<pipe::Ask>(
        r#"{"ask":"export","path":"C:\\out\\page.pdf","width":1280,"height":5819}"#,
    );
    assert!(matches!(
        ask,
        Ok(pipe::Ask::Export { ref path, width, height })
            if path == Path::new(r#"C:\out\page.pdf"#) && width == 1280.0 && height == 5819.0
    ));

    // No dialog on the write path the ask runs, and the appearance held across it the way the button's own press holds it — a render emulates a light color scheme, and without the hold the file comes out in the light theme.
    let write = include_str!("../fileops.rs");
    let body = write
        .split("pub(crate) fn write_page_pdf_at")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the ask's own write");
    assert!(
        !body.contains("pick_export_path"),
        "the ask must not open a dialog nobody can answer: {body}"
    );
    assert!(
        body.contains("leafHoldAppearance(true)") && body.contains("leafHoldAppearance(false)"),
        "the appearance is held across the render and released after it: {body}"
    );

    // Its own wait. Two seconds is what every other ask gets, and a twenty-screen document takes longer than that to render.
    let source = include_str!("../../pipe.rs");
    assert!(
        source.contains("Ask::Export { .. } => EXPORT_TIMEOUT,"),
        "an export that outlasts the ordinary wait would be reported as a stuck app"
    );
}

/// What a Mac reader gets when they press Export and pick the PDF row. The arm is Mac code and nothing here compiles or runs it, so the proof is the source: the panel switched off, the chosen path named as where the job saves to, and the sheet the page measured spent rather than dropped. Read the same way as the ask above it, for the same reason.
#[test]
fn the_mac_export_switches_the_print_panel_off_and_saves_to_the_chosen_path() {
    let write = include_str!("../fileops.rs");
    let body = write
        .split(
            "#[cfg(target_os = \"macos\")]
fn write_page_pdf(",
        )
        .nth(1)
        .expect("the Mac arm's own write");

    // The whole point of the ticket: no sheet asking about paper, and no progress window over a render that is writing a file.
    assert!(
        body.contains("setShowsPrintPanel(false)") && body.contains("setShowsProgressPanel(false)"),
        "a Mac export must raise no panel: {body}"
    );
    assert!(
        !body.contains("page.print()"),
        "the plain print call is the panel: {body}"
    );

    // The reader answered where the file goes before any of this ran, so the job saves to that answer rather than asking again.
    assert!(
        body.contains("NSPrintSaveJob") && body.contains("NSPrintJobSavingURL"),
        "the chosen path is where the job saves to: {body}"
    );
    assert!(
        body.contains("NSURL::fileURLWithPath") && body.contains("target.to_string_lossy()"),
        "the path spent is the one handed in: {body}"
    );

    // Its own settings, not the app's. The shared ones are what a later print reads.
    assert!(
        body.contains("NSPrintInfo::new()") && !body.contains("sharedPrintInfo"),
        "an export must not scribble in the app's session-wide print settings: {body}"
    );

    // The size the page measured, through the same sheet arithmetic Windows asks, written in the unit a Mac page size takes.
    assert!(
        body.contains("sheet_inches((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH)"),
        "both desktops divide a tall document the same way: {body}"
    );
    assert!(
        body.contains("const POINTS_PER_INCH: f64 = 72.0;") && body.contains("* POINTS_PER_INCH"),
        "a Mac page size is points, and inches written there is a sheet a third of the size: {body}"
    );
    assert!(
        body.contains("setScalingFactor(1.0)"),
        "fitting the document onto its own sheet is the blank paper the Windows half spent rounds on: {body}"
    );

    // Nothing here can watch the operation finish, so the growl answers on the file.
    assert!(
        body.contains("std::fs::metadata(target)") && body.contains("file.len() > 0"),
        "a saved growl must never name a file nobody wrote: {body}"
    );
}

/// Export, which is one press and one file: the page measures itself so the host can make one continuous page of it, and the save window says where it goes and in what format. The open document only names the file that is suggested — nothing about it is read or written, and what makes the rendered page a document rather than one screen of app frame is the stylesheet, not this.
#[test]
fn export_pdf_carries_the_format_and_the_page_size_it_needs() {
    let parsed = serde_json::from_str::<IpcCommand>(
        r#"{"command":"exportPdf","format":"pdf","width":1280,"height":5819}"#,
    );
    assert!(matches!(
        parsed,
        Ok(IpcCommand::ExportPdf { ref format, width, height })
            if format == "pdf" && width == 1280.0 && height == 5819.0
    ));

    // The chooser's format and the page's own size go straight on.
    let mut workspace = Workspace::default();
    assert_eq!(
        page_export_request(&workspace, "pdf".to_string(), 1280.0, 5819.0),
        PageExport {
            document: None,
            format: "pdf".to_string(),
            width: 1280.0,
            height: 5819.0,
        },
        "the home screen exports too, with no document to name the file after"
    );
    workspace.open_path(PathBuf::from("/docs/notes.md"));
    assert_eq!(
        page_export_request(&workspace, "pdf".to_string(), 1280.0, 5819.0).document,
        Some(PathBuf::from("/docs/notes.md")),
        "and the open document names the file the save dialog suggests"
    );

    // The open document is read for its name and nothing else: a chosen path and a page size are all the write needs, so the home screen exports too.
    let write = include_str!("../fileops.rs");
    let body = write
        .split("pub(crate) fn export_page(")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the export body");
    assert!(
        body.contains("Path::file_stem") && !body.contains("active_edit"),
        "the export names the file after the document and reads nothing else of it: {body}"
    );

    // The sheet is the height the page measured, plus a hair against rounding, divided into equal pages only where one page cannot hold it. A proportional allowance was tried and on a document twenty screens tall it is most of a sheet of white below the last line.
    assert!(
        write.contains(
            ".SetPageHeight(sheet_inches((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH))"
        ),
        "the page height is taken as given rather than scaled"
    );
    assert!(
        write.contains("const HAIR_OF_PAPER: f64 = 4.0;"),
        "the allowance is a pixel count rather than a share of the document"
    );
    // Rounded up rather than down: a sheet a fraction shorter than what is laid out on it is a whole second page with almost nothing on it.
    assert!(
        write.contains("let sheet = (inches / sheets * 100.0).ceil() / 100.0;"),
        "the sheet is never rounded to less than the document needs"
    );
}

/// The other row in that window: the page as a web page, its stylesheet and its pictures in one `assets` folder beside it.
///
/// Every picture the app draws is addressed on a scheme no browser can fetch, with a per-render stamp on the end of it, so a page written from the live markup is a page of broken pictures until every one is copied and re-addressed. One copy per file however many times the document draws it, and two documents exported into one folder share that folder — which is why a name already there is written beside rather than over.
#[test]
fn an_exported_page_copies_each_picture_once_and_never_over_one_already_there() {
    use crate::app::fileops::{write_exported_page, PageHtmlExport};

    let root = scratch_dir("exported-page-pictures");
    let notes = root.join("notes");
    let other = root.join("other");
    let out = root.join("out");
    for folder in [notes.join("imgs"), other.join("imgs"), out.clone()] {
        fs::create_dir_all(&folder).expect("the fixture folders are made");
    }
    fs::write(notes.join("imgs/shot.png"), b"first picture").expect("the first picture is written");
    fs::write(other.join("imgs/shot.png"), b"second picture")
        .expect("the second picture is written");

    // The same picture twice, the way a document that draws it twice arrives, each carrying the epoch stamp the page adds so a replaced file is re-fetched rather than shown stale.
    let drawn = |stamp: u32| {
        format!(
            "<p><img src=\"http://leaf-image.local/imgs/shot.png?leaf-epoch={stamp}\" alt=\"one\"><img src=\"http://leaf-image.local/imgs/shot.png?leaf-epoch={stamp}\" alt=\"again\"><img src=\"https://example.com/away.png\" alt=\"away\"></p>"
        )
    };
    let export = |markup: String| PageHtmlExport {
        markup,
        sheet: String::new(),
        theme: "moss".to_string(),
        appearance: "dark".to_string(),
        title: "Notes".to_string(),
    };

    write_exported_page(&out.join("notes.html"), &export(drawn(4)), Some(&notes))
        .expect("the page is written");
    let page = fs::read_to_string(out.join("notes.html")).expect("the page reads back");

    assert_eq!(
        fs::read(out.join("assets/shot.png")).expect("the picture is copied"),
        b"first picture",
        "the picture beside the note is the one that travels"
    );
    assert_eq!(
        page.matches("src=\"assets/shot.png\"").count(),
        2,
        "both drawings point at the one copy: {page}"
    );
    assert!(
        !page.contains("leaf-epoch") && !page.contains("leaf-image"),
        "the exported page keeps no address only this app can fetch: {page}"
    );
    // A picture served over the network is nobody's file to copy, and leaving it addressed as it was is what keeps the page opening.
    assert!(
        page.contains("src=\"https://example.com/away.png\""),
        "a picture off the network was rewritten: {page}"
    );
    assert!(
        fs::read_to_string(out.join("assets/app.css"))
            .expect("the stylesheet is written")
            .contains(".app-surface"),
        "the whole reading stylesheet travels beside the page"
    );

    // A second document into the same folder, whose picture has the same name and is a different file. Overwriting would silently replace a picture belonging to a page somebody exported yesterday.
    write_exported_page(&out.join("other.html"), &export(drawn(9)), Some(&other))
        .expect("the second page is written");
    assert_eq!(
        fs::read(out.join("assets/shot.png")).expect("the first picture is still there"),
        b"first picture",
        "the second export wrote over the first export's picture"
    );
    assert_eq!(
        fs::read(out.join("assets/shot-2.png")).expect("the second picture is copied beside it"),
        b"second picture"
    );
    let second = fs::read_to_string(out.join("other.html")).expect("the second page reads back");
    assert_eq!(
        second.matches("src=\"assets/shot-2.png\"").count(),
        2,
        "the second page points at its own copy: {second}"
    );
}

/// Exporting one document twice is what a reader does — export, spot a typo, fix it, export again — and the folder beside the page has to hold one copy of its picture however many times they do it.
///
/// Watched before this: three exports left three copies of one picture, all but the newest addressed by nothing. The naming asked whether a name was taken and had to ask whether it was taken by something else — at every name the numbering walks through, because a folder already holding another document's picture under that name is the folder the numbering exists for and would otherwise climb a number per export for ever.
#[test]
fn re_exporting_a_page_addresses_the_picture_it_already_wrote() {
    use crate::app::fileops::{write_exported_page, PageHtmlExport};

    let root = scratch_dir("exported-page-re-export");
    let notes = root.join("notes");
    let out = root.join("out");
    for folder in [notes.join("imgs"), out.clone()] {
        fs::create_dir_all(&folder).expect("the fixture folders are made");
    }
    fs::write(notes.join("imgs/shot.png"), b"the picture").expect("the picture is written");

    let export = |stamp: u32| {
        PageHtmlExport {
        markup: format!(
            "<p><img src=\"http://leaf-image.local/imgs/shot.png?leaf-epoch={stamp}\" alt=\"one\"></p>"
        ),
        sheet: String::new(),
        theme: "moss".to_string(),
        appearance: "dark".to_string(),
        title: "Notes".to_string(),
    }
    };

    // The same document to the same place three times, which is the gesture the Web page row of the save window makes.
    for stamp in 1..=3 {
        write_exported_page(&out.join("notes.html"), &export(stamp), Some(&notes))
            .expect("the page is written");
        let page = fs::read_to_string(out.join("notes.html")).expect("the page reads back");
        assert!(
            page.contains("src=\"assets/shot.png\""),
            "export {stamp} pointed somewhere other than the one copy: {page}"
        );
    }
    let copies: Vec<String> = fs::read_dir(out.join("assets"))
        .expect("the assets folder reads back")
        .map(|entry| {
            entry
                .expect("the entry reads")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .filter(|name| name.ends_with(".png"))
        .collect();
    assert_eq!(
        copies,
        vec!["shot.png".to_string()],
        "re-exporting left another copy of the picture: {copies:?}"
    );

    // The folder the numbering exists for: another document's picture already sitting under this one's name. The first export takes the number beside it and every export after that has to take the same one.
    let other = root.join("other");
    let elsewhere = root.join("elsewhere");
    for folder in [other.join("imgs"), elsewhere.clone()] {
        fs::create_dir_all(&folder).expect("the fixture folders are made");
    }
    fs::write(other.join("imgs/shot.png"), b"a different picture")
        .expect("the second picture is written");
    fs::create_dir_all(elsewhere.join("assets")).expect("the assets folder is made");
    fs::write(
        elsewhere.join("assets/shot.png"),
        b"somebody else's picture",
    )
    .expect("the picture already there is written");

    for stamp in 1..=2 {
        write_exported_page(&elsewhere.join("other.html"), &export(stamp), Some(&other))
            .expect("the page is written");
        let page = fs::read_to_string(elsewhere.join("other.html")).expect("the page reads back");
        assert!(
            page.contains("src=\"assets/shot-2.png\""),
            "export {stamp} climbed past the copy it had already written: {page}"
        );
    }
    assert!(
        !elsewhere.join("assets/shot-3.png").exists(),
        "a second copy was written beside the one already there"
    );
    assert_eq!(
        fs::read(elsewhere.join("assets/shot.png"))
            .expect("the picture already there is still there"),
        b"somebody else's picture",
        "the export wrote over a picture belonging to a page somebody exported earlier"
    );
}

/// The rail's script goes into `assets` beside the stylesheet on every export, whatever the document holds.
///
/// Not conditional the way the math stylesheet is: a document's own length is not the question the rail answers. The reader handed this file has no library pane, no outline and no tab strip, so the rail is the only thing telling them the shape of what they were sent. It is the site's own script with the `export` mark off and a call on its foot, because a browser refuses a module script on a page opened off a disk.
#[test]
fn an_exported_page_writes_the_rails_script_beside_its_stylesheet() {
    use crate::app::fileops::{write_exported_page, PageHtmlExport};

    let root = scratch_dir("exported-page-minimap");
    let out = root.join("out");
    fs::create_dir_all(&out).expect("the fixture folder is made");

    write_exported_page(
        &out.join("notes.html"),
        &PageHtmlExport {
            markup: "<div class=\"app-surface\"><p>hello</p></div>".to_string(),
            sheet: String::new(),
            theme: "moss".to_string(),
            appearance: "dark".to_string(),
            title: "Notes".to_string(),
        },
        None,
    )
    .expect("the page is written");

    let script =
        fs::read_to_string(out.join("assets/minimap.js")).expect("the rail's script is written");
    assert!(
        script.contains("function initMinimap(source)") && !script.contains("export "),
        "the script beside the page is still a module, which a browser will not load off a disk"
    );
    assert!(
        script
            .trim_end()
            .ends_with("initMinimap(document.querySelector('.document-body'));"),
        "the script beside the page never calls itself"
    );
    // Named off the same folder as the stylesheet, so the two are written and named together.
    let page = fs::read_to_string(out.join("notes.html")).expect("the page reads back");
    assert!(
        page.contains("<script src=\"assets/minimap.js\" defer></script>"),
        "the page does not name the script written beside it: {page}"
    );
}

/// A picture the app could not load is not a picture in the live markup at all: the page swaps its source for a transparent pixel and paints our own broken-picture mark over it. The page puts the address back before it sends the markup, so what the export names is the file the document asked for — and the browser draws its own mark where it is still not there, which says what an empty space cannot.
#[test]
fn an_exported_page_names_a_missing_picture_rather_than_our_own_mark() {
    use crate::app::fileops::{write_exported_page, PageHtmlExport};

    let root = scratch_dir("exported-page-missing-picture");
    let notes = root.join("notes");
    let out = root.join("out");
    for folder in [notes.clone(), out.clone()] {
        fs::create_dir_all(&folder).expect("the fixture folders are made");
    }

    write_exported_page(
        &out.join("notes.html"),
        &PageHtmlExport {
            markup:
                "<p><img src=\"http://leaf-image.local/imgs/gone.png?leaf-epoch=2\" alt=\"\"></p>"
                    .to_string(),
            sheet: String::new(),
            theme: "moss".to_string(),
            appearance: "light".to_string(),
            title: "Notes".to_string(),
        },
        Some(&notes),
    )
    .expect("the page is written");
    let page = fs::read_to_string(out.join("notes.html")).expect("the page reads back");

    assert!(
        page.contains("src=\"assets/gone.png\""),
        "the page names the file the document asked for: {page}"
    );
    assert!(
        !page.contains("data:image/gif"),
        "the transparent pixel behind our broken-picture mark was exported as the picture: {page}"
    );
    assert!(
        !out.join("assets/gone.png").exists(),
        "a file that is not there was invented"
    );

    // The other half is the page's: the live markup carries the mark and the pixel, and putting the address back is what makes it arrive here as above.
    let cleaner = include_str!("../../assets/shell/overflow.js");
    assert!(
        cleaner.contains("copy.querySelectorAll('img').forEach(restoreMissingImage);"),
        "the export's copy no longer puts a missing picture's own address back"
    );
}

/// Math is the one thing the reading stylesheet does not carry, so it is the one thing that has to travel beside a page with an equation in it — and only beside that page.
///
/// Watched in a real browser: with no math stylesheet the equation prints twice on one line, because KaTeX renders two copies of itself and the sheet is what hides one of them. It comes to 283,127 bytes with its twenty faces, which is why an ordinary document carries none of it.
#[test]
fn an_exported_page_carries_the_math_stylesheet_only_where_there_is_math() {
    use crate::app::fileops::{write_exported_page, PageHtmlExport};

    let root = scratch_dir("exported-page-math");
    let with_math = root.join("with-math");
    let plain = root.join("plain");
    for folder in [with_math.clone(), plain.clone()] {
        fs::create_dir_all(&folder).expect("the fixture folders are made");
    }
    let export = |markup: &str| PageHtmlExport {
        markup: markup.to_string(),
        sheet: String::new(),
        theme: "moss".to_string(),
        appearance: "dark".to_string(),
        title: "Notes".to_string(),
    };

    write_exported_page(
        &with_math.join("notes.html"),
        &export("<p><span class=\"math math-inline\" data-math-rendered=\"true\"><span class=\"katex\">E</span></span></p>"),
        None,
    )
    .expect("the page with math is written");
    let page = fs::read_to_string(with_math.join("notes.html")).expect("the page reads back");

    assert!(
        page.contains("href=\"assets/katex.min.css\""),
        "the page with an equation in it did not name the stylesheet that draws one: {page}"
    );
    assert!(
        fs::read(with_math.join("assets/katex.min.css"))
            .expect("the math stylesheet is written")
            .len()
            > 0
    );
    // The stylesheet addresses its faces as `fonts/…` beside itself, so that is the folder they go in.
    let faces = fs::read_dir(with_math.join("assets/fonts"))
        .expect("the faces folder is written")
        .count();
    assert_eq!(faces, 20, "every face the math stylesheet asks for travels");

    // An ordinary document is the common case, and it stays the size the page and its own stylesheet come to.
    write_exported_page(
        &plain.join("notes.html"),
        &export("<p>no math here</p>"),
        None,
    )
    .expect("the plain page is written");
    let plain_page = fs::read_to_string(plain.join("notes.html")).expect("the page reads back");
    assert!(
        !plain_page.contains("katex"),
        "a document with no equation in it named the math stylesheet: {plain_page}"
    );
    assert!(
        !plain.join("assets/katex.min.css").exists() && !plain.join("assets/fonts").exists(),
        "a document with no equation in it carried the math stylesheet and its faces"
    );
}

/// The ceiling on a PDF page, and what a document past it comes out as. Cut at the ceiling, a document a little over is one full sheet and a mostly blank one — which is the blank paper a reader meets and cannot explain. Divided, every sheet is full and the last ends at the last line. Both desktops ask it, so both desktops run this.
#[test]
fn a_document_taller_than_a_pdf_page_is_divided_into_equal_sheets() {
    use crate::app::fileops::sheet_inches;

    // Under the ceiling it is its own height, so one continuous page stays one continuous page.
    assert_eq!(sheet_inches(60.0), 60.0);
    assert_eq!(sheet_inches(200.0), 200.0);

    // A hair over, and the answer is two half sheets rather than a full one and a sliver.
    assert_eq!(sheet_inches(202.0), 101.0);
    // The document read on a running copy: 292 inches over a 200-inch ceiling.
    assert_eq!(sheet_inches(292.0), 146.0);
    // Nothing is ever asked for past the ceiling, whatever the arithmetic came to.
    for tall in [1.0, 199.9, 200.1, 401.0, 100_000.0] {
        let sheet = sheet_inches(tall);
        assert!(sheet > 0.0 && sheet <= 200.0, "{tall} gave {sheet}");
        // And every sheet holds its share: the pages multiply back to at least the document.
        let sheets = (tall as f64 / sheet).ceil();
        assert!(
            sheet * sheets >= tall - 0.001,
            "{tall} over {sheets} sheets of {sheet}"
        );
    }
}
