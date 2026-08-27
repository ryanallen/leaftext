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
fn a_page_picture_is_measured_off_its_own_header_or_refused() {
    // The engine answers an empty file when a format cannot hold a page this size, and that is the only way it ever says no — so "did a picture come back" is read off the bytes rather than off an error, and a header that does not parse has to mean nothing was written rather than a file nobody can open.

    // A PNG: the signature, the IHDR length, the name, then the two sizes.
    let png = |width: u32, height: u32| {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    };
    assert_eq!(picture_pixel_size(&png(1137, 29077)), Some((1137, 29077)));
    // The tallest page the engine has been asked for, and one pixel of picture: both are pictures.
    assert_eq!(picture_pixel_size(&png(1, 1)), Some((1, 1)));
    // A header claiming no pixels is not a picture, whatever its signature says.
    assert_eq!(picture_pixel_size(&png(0, 900)), None);
    assert_eq!(picture_pixel_size(&png(900, 0)), None);

    // A WebP: RIFF, the file size, WEBP, then the extended header, which carries each side as three little-endian bytes holding one less than the real value.
    let webp = |width: u32, height: u32| {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(b"WEBPVP8X");
        // The chunk's length, its flags and the three reserved bytes it carries before the sizes.
        bytes.extend_from_slice(&10u32.to_le_bytes());
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        for side in [width, height] {
            let less = side - 1;
            bytes.extend_from_slice(&[
                (less & 0xff) as u8,
                ((less >> 8) & 0xff) as u8,
                ((less >> 16) & 0xff) as u8,
            ]);
        }
        bytes
    };
    assert_eq!(picture_pixel_size(&webp(1137, 4091)), Some((1137, 4091)));
    // The tallest side the format holds, which is where the row below it stops being offered.
    assert_eq!(picture_pixel_size(&webp(1137, 16383)), Some((1137, 16383)));

    // The empty answer, which is the whole reason this function exists: a page the format could not hold.
    assert_eq!(picture_pixel_size(b""), None);
    // Anything that is not a picture at all, and a header cut off before its sizes.
    assert_eq!(
        picture_pixel_size(b"not a picture at all, not even close"),
        None
    );
    assert_eq!(picture_pixel_size(&png(1137, 29077)[..20]), None);
    assert_eq!(picture_pixel_size(b"RIFF\0\0\0\0WEBP"), None);

    // A JPEG, which is the one of the three whose sizes are not at a fixed offset: the opening marker, however many segments the encoder wrote, then the frame header carrying the height first and the width second. `before` is what an encoder puts in front of it — a thumbnail, a color profile, the quantization tables — and every one of them has to be stepped over by its own length.
    let jpeg = |width: u16, height: u16, before: &[(u8, usize)]| {
        let mut bytes = vec![0xff, 0xd8];
        for (marker, payload) in before {
            bytes.extend_from_slice(&[0xff, *marker]);
            bytes.extend_from_slice(&((payload + 2) as u16).to_be_bytes());
            bytes.extend(std::iter::repeat_n(0u8, *payload));
        }
        // The frame header: eight bytes of payload, opening with the precision.
        bytes.extend_from_slice(&[0xff, 0xc0, 0x00, 0x11, 0x08]);
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&[0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    };
    // Nothing in front of the frame header, and the ordinary case with three segments in front of it.
    assert_eq!(
        picture_pixel_size(&jpeg(1137, 4000, &[])),
        Some((1137, 4000))
    );
    assert_eq!(
        picture_pixel_size(&jpeg(1137, 29077, &[(0xe0, 14), (0xe2, 3144), (0xdb, 65)])),
        Some((1137, 29077))
    );
    // The three markers sharing the frame header's own range that are not frame headers: stepped over rather than read as sizes.
    assert_eq!(
        picture_pixel_size(&jpeg(800, 600, &[(0xc4, 29), (0xcc, 4), (0xc8, 2)])),
        Some((800, 600))
    );
    // A progressive frame, which is the other header an encoder writes and carries its sizes in the same place.
    let mut progressive = jpeg(640, 480, &[]);
    // The frame header opens this one, so its marker is the fourth byte of the file.
    progressive[3] = 0xc2;
    assert_eq!(picture_pixel_size(&progressive), Some((640, 480)));
    // The tallest side the format holds at all.
    assert_eq!(
        picture_pixel_size(&jpeg(1137, 65535, &[])),
        Some((1137, 65535))
    );
    // A frame header claiming no pixels is not a picture, the way a PNG one is not.
    assert_eq!(picture_pixel_size(&jpeg(0, 600, &[])), None);
    assert_eq!(picture_pixel_size(&jpeg(800, 0, &[])), None);
    // A file that opens as a JPEG and never reaches a frame header: the chain runs off the end, which is what a page the format could not hold would come back as.
    assert_eq!(picture_pixel_size(&[0xff, 0xd8, 0xff, 0xd9]), None);
    assert_eq!(picture_pixel_size(&jpeg(1137, 4000, &[])[..8]), None);
    // A segment claiming a length shorter than the two bytes the length itself takes, which would walk the reader backwards for ever.
    assert_eq!(
        picture_pixel_size(&[0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0, 0]),
        None
    );
    // A byte where a marker has to be: not a JPEG, whatever it opened with.
    assert_eq!(
        picture_pixel_size(&[0xff, 0xd8, 0x41, 0x41, 0x41, 0x41]),
        None
    );
}

#[test]
fn only_the_endings_the_save_window_offers_reach_the_engine() {
    // The picture rows are written by asking the web view's own engine for a format by name, so an ending nobody offered must be refused before that ask rather than sent through as a name the engine has never heard of.
    assert!(
        page_picture_format("png").is_some(),
        "the PNG row is offered on both platforms and has to be writable on both"
    );
    for offered in ["jpg", "jpeg"] {
        assert!(
            page_picture_format(offered).is_some(),
            "the JPEG row is offered on both platforms, so both its spellings have to be writable on both"
        );
    }
    for unoffered in ["pdf", "html", "htm", "gif", "svg", "", "PNG"] {
        assert!(
            page_picture_format(unoffered).is_none(),
            "{unoffered} is not a picture row this window offers, so it must not reach the engine"
        );
    }

    // Every picture ending the save window offers is one the engine writes, and every one it writes is offered: two lists that disagree is a row that writes nothing, or a format nobody can pick.
    for (label, endings) in page_export_rows() {
        for ending in endings {
            let offered = page_picture_format(ending).is_some();
            let a_picture = matches!(
                page_export_kind(Path::new(&format!("a.{ending}"))),
                Some(PageExportKind::Picture)
            );
            assert_eq!(
                offered, a_picture,
                "the {label} row spells {ending}, which the window and the engine disagree about"
            );
        }
    }

    // Every row this platform offers is one something answers for. A row reaching the save window that nothing answers is a reader picking a format and getting no file and no reason.
    let offered = page_export_rows();
    assert!(!offered.is_empty(), "the save window was left with no rows");
    for (label, endings) in &offered {
        for ending in *endings {
            assert!(
                page_export_kind(Path::new(&format!("a.{ending}"))).is_some(),
                "the {label} row offers .{ending} and nothing answers for it"
            );
        }
    }

    // The table's own rows, in the order the window offers them: PDF leads because Windows names a file with no ending off the first, and the three pictures run together at the foot with JPEG under the two it is measured against.
    assert_eq!(
        PAGE_EXPORT_FORMATS,
        &[
            ("PDF document", &["pdf"][..]),
            ("Web page", &["html", "htm"][..]),
            ("PNG picture", &["png"][..]),
            ("WebP picture", &["webp"][..]),
            ("JPEG picture", &["jpg", "jpeg"][..]),
        ],
        "the page window offers a format in an order that names a bare file wrongly, or splits its pictures"
    );

    // And they are the one table's own rows, in its own order — a filter that reordered or invented one would be a second table wearing the first one's name.
    let every: Vec<&str> = PAGE_EXPORT_FORMATS
        .iter()
        .map(|(label, _)| *label)
        .collect();
    let mut past = 0;
    for (label, _) in &offered {
        let at = every[past..]
            .iter()
            .position(|one| one == label)
            .unwrap_or_else(|| {
                panic!("{label} is offered and is not in the one table, or is out of its order")
            });
        past += at + 1;
    }

    // PDF first, because Windows names a file with no ending off the first row and a reader who types nothing should still get the format the app has always written.
    assert_eq!(
        offered[0].1[0], "pdf",
        "the row a bare name is written under moved"
    );

    // WebP is the one row a platform can be short of, and the difference is the bitmap on a Mac: it writes PNG and does not write WebP, so a Mac must never be offered the row.
    assert_eq!(
        offered.iter().any(|(_, endings)| endings.contains(&"webp")),
        cfg!(target_os = "windows"),
        "the WebP row is offered where the engine behind the view writes one, and nowhere else"
    );
}

#[test]
fn a_page_too_big_for_its_format_is_refused_in_words_that_name_the_row_that_holds_it() {
    // The engine behind the web view answers an empty file when a format cannot hold a page this size — watched at 1,137 by 29,077, where WebP came back with zero bytes — and that is the only way it ever says no. So the refusal is written on nothing having come back, which stays true of every format and every future ceiling with no number in the app to keep in step.
    let refused = PageShot::from_bytes(Vec::new())
        .err()
        .expect("a picture with no bytes in it is not a picture");

    // The reader picked a row and pressed Save, so the sentence has to say that nothing was written — an app that says only "too big" leaves them looking for a file.
    assert!(
        refused.to_lowercase().contains("nothing was written"),
        "a refusal that does not say the file was not written sends the reader looking for it: {refused}"
    );
    // And it names the row that can hold it, because the reader wants the picture rather than the format.
    assert!(
        refused.to_uppercase().contains("PNG"),
        "the refusal has to name the row with no such limit: {refused}"
    );

    // A picture that did come back is measured rather than refused, however large.
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&13u32.to_be_bytes());
    png.extend_from_slice(b"IHDR");
    png.extend_from_slice(&1137u32.to_be_bytes());
    png.extend_from_slice(&29077u32.to_be_bytes());
    let held = PageShot::from_bytes(png).expect("a page this size is a picture PNG holds");
    assert_eq!((held.width, held.height), (1137, 29077));
}

#[test]
fn only_rendering_an_export_holds_the_page_s_appearance() {
    // Read as source, because the whole of `export_page` is a native window, a render and a web view. The save window, web-page handoff and refused ending must leave the reader alone; only the PDF and picture renders hold it.
    let file = include_str!("../fileops.rs");
    let body = file
        .split("pub(crate) fn export_page(")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the page export");

    assert_eq!(
        body.matches("release(page)").count(),
        2,
        "only the PDF and picture renders have a hold to release: {body}"
    );
    let before_arms = body
        .split("match page_export_kind(&target)")
        .next()
        .expect("the save window");
    assert!(
        !before_arms.contains("release(page)"),
        "canceling the save window released a hold that was never raised: {before_arms}"
    );
    let web = body
        .split("Some(PageExportKind::WebPage) => {")
        .nth(1)
        .and_then(|rest| rest.split("None => {").next())
        .expect("the web-page arm");
    assert!(
        !web.contains("release(page)"),
        "the web-page handoff released a hold that was never raised: {web}"
    );
    let unknown = body
        .split("None => {")
        .nth(1)
        .expect("the refused-ending arm");
    assert!(
        !unknown.contains("release(page)"),
        "a refused ending released a hold that was never raised: {unknown}"
    );
}

#[test]
fn every_page_render_is_held_before_it_starts() {
    // Held as source because both page writers take a `&WebView`, and nothing in this suite can build one.
    let file = include_str!("../fileops.rs");
    for (function, render) in [
        ("pub(crate) fn write_page_pdf_at", "write_page_pdf(page"),
        ("pub(crate) fn write_page_picture_at", "capture_page(page"),
    ] {
        let body = file
            .split(function)
            .nth(1)
            .and_then(|rest| {
                rest.split(
                    "
/// ",
                )
                .next()
            })
            .unwrap_or_else(|| panic!("{function} is missing"));
        let held = body
            .find("leafHoldAppearance(true)")
            .unwrap_or_else(|| panic!("{function} never holds the page"));
        let rendered = body
            .find(render)
            .unwrap_or_else(|| panic!("{function} never reaches its render"));
        assert!(
            held < rendered,
            "{function} starts its render before the paper rules reach the page: {body}"
        );
    }
}

#[test]
fn page_export_rows_keep_their_output_bytes() {
    // Held as source because `export_page` takes a `&WebView`, and nothing in this suite can build one.
    let file = include_str!("../fileops.rs");
    let export = file
        .split("pub(crate) fn export_page(")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the page export");
    for unchanged_write in [
        "write_page_pdf(page, &target, width, height)",
        "write_page_picture_at(webview, scale, &target, width, height)",
        "page_html_export_script(&target.display().to_string())",
    ] {
        assert!(
            export.contains(unchanged_write),
            "the export stopped handing a row to its existing byte writer unchanged: {unchanged_write}"
        );
    }
    let picture = file
        .split("pub(crate) fn write_page_picture_at")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the page picture writer");
    assert!(
        picture.contains("std::fs::write(target, &shot.bytes)"),
        "the picture render no longer writes the engine's bytes unchanged: {picture}"
    );
}

#[test]
fn every_page_export_is_covered_only_while_its_work_runs() {
    // Held as source because `export_page` takes a `&WebView`, and nothing in this suite can build one.
    let file = include_str!("../fileops.rs");
    let export = file
        .split("pub(crate) fn export_page(")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the page export");
    let printed = export
        .split("Some(PageExportKind::Printed) => {")
        .nth(1)
        .and_then(|rest| rest.split("Some(PageExportKind::Picture) => {").next())
        .expect("the PDF arm");
    let web = export
        .split("Some(PageExportKind::WebPage) => {")
        .nth(1)
        .and_then(|rest| rest.split("None => {").next())
        .expect("the web-page arm");
    for (body, work) in [
        (printed, "write_page_pdf(page"),
        (web, "page_html_export_script"),
    ] {
        let raised = body.find("ExportCover::raise(page)").expect("the cover");
        let worked = body
            .find(work)
            .unwrap_or_else(|| panic!("{work} is missing"));
        let dropped = body.find("drop(cover)").expect("the cover drop");
        assert!(
            raised < worked && worked < dropped,
            "the native sheet does not cover the whole export work: {body}"
        );
    }

    for (function, render) in [
        ("pub(crate) fn write_page_pdf_at", "write_page_pdf(page"),
        ("pub(crate) fn write_page_picture_at", "capture_page(page"),
    ] {
        let body = file
            .split(function)
            .nth(1)
            .and_then(|rest| {
                rest.split(
                    "
/// ",
                )
                .next()
            })
            .unwrap_or_else(|| panic!("{function} is missing"));
        let raised = body.find("ExportCover::raise(page)").expect("the cover");
        let held = body.find("leafHoldAppearance(true)").expect("the hold");
        let rendered = body.find(render).expect("the render");
        let released = body.find("leafHoldAppearance(false)").expect("the release");
        let dropped = body.find("drop(cover)").expect("the cover drop");
        assert!(
            raised < held && held < rendered && rendered < released && released < dropped,
            "the page is uncovered before its render has restored the reader: {body}"
        );
    }

    let picture = file
        .split("pub(crate) fn write_page_picture_at")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
/// ",
            )
            .next()
        })
        .expect("the picture writer");
    assert!(
        picture.find("ExportCover::raise(page)") < picture.find("page_picture_format(&ending)"),
        "a refused picture ending must still drop a cover it raised: {picture}"
    );
    assert!(
        picture.find("drop(cover)") < picture.find("let shot = outcome?"),
        "a failed picture render must uncover the reader before returning: {picture}"
    );

    // Held as source because the cover is a native sheet raised on a window, and nothing in this suite can build one.
    let cover = include_str!("../export_cover.rs");
    assert!(
        cover.contains("impl Drop for ExportCover") && cover.contains("self.native.remove()"),
        "every early return must uncover the reader through the cover's drop: {cover}"
    );
    // Held as source for that same window: the color reaches a platform call on the native sheet.
    let chrome = include_str!("../window_cmds.rs");
    assert!(
        chrome.contains("set_export_cover_color(r, g, b)"),
        "the native sheet must take the color the page reports for its own frame: {chrome}"
    );
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
    //
    // Held as source because `write_page_pdf_at` takes a `&WebView`, and nothing in this suite can build one.
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

    // Its own wait. Two seconds is what every other ask gets, and a twenty-screen document takes longer than that to render — which is true of the picture the `shot` ask writes as well, so both share the arm.
    let ordinary = pipe::ask_wait(&pipe::Ask::State { reader: false });
    for writes_a_file in [
        pipe::Ask::Export {
            path: PathBuf::from("/out/page.pdf"),
            width: 1280.0,
            height: 5819.0,
        },
        pipe::Ask::Shot {
            path: PathBuf::from("/out/page.png"),
            width: 1280.0,
            height: 5819.0,
        },
    ] {
        assert!(
            pipe::ask_wait(&writes_a_file) > ordinary,
            "{writes_a_file:?} outlasts the ordinary wait, so it would be reported as a stuck app"
        );
    }
}

/// What a Mac reader gets when they press Export and pick the PDF row. The arm is Mac code and nothing here compiles or runs it, so the proof is the source: the panel switched off, the chosen path named as where the job saves to, and the sheet the page measured spent rather than dropped. Read the same way as the ask above it, for the same reason.
#[test]
fn the_mac_export_switches_the_print_panel_off_and_saves_to_the_chosen_path() {
    // Held as source because this is a Mac arm nothing here compiles, let alone runs.
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

    // The size the page measured, through the same paper arithmetic Windows asks, written in the unit a Mac page size takes — and the scale it answers is the one the operation prints at.
    assert!(
        body.contains("paper_for((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH)"),
        "both desktops fit a tall document onto one page the same way: {body}"
    );
    assert!(
        body.contains("settings.setScalingFactor(paper.scale);"),
        "a Mac must print at the scale the paper arithmetic answered: {body}"
    );
    assert!(
        body.contains("const POINTS_PER_INCH: f64 = 72.0;") && body.contains("* POINTS_PER_INCH"),
        "a Mac page size is points, and inches written there is a sheet a third of the size: {body}"
    );
    // Never the panel's own fit: fitting the document onto its own sheet is the blank paper the Windows half spent rounds on, and the scale printed at is the paper arithmetic's alone.
    assert!(
        !body.contains("setScalingFactor(1.0)") && !body.contains("setHorizontalPagination"),
        "the scale is the paper arithmetic's, never a fixed one or the panel's fit: {body}"
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
    //
    // Held as source because `export_page` takes a `&WebView`, and nothing in this suite can build one.
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
    let printed = body
        .split("Some(PageExportKind::Printed) => {")
        .nth(1)
        .and_then(|rest| rest.split("Some(PageExportKind::Picture) => {").next())
        .expect("the PDF export arm");
    let held = printed
        .find("leafHoldAppearance(true)")
        .expect("the PDF hold");
    let rendered = printed.find("write_page_pdf(page").expect("the PDF render");
    let released = printed.find("release(page)").expect("the PDF release");
    assert!(
        held < rendered && rendered < released,
        "the PDF render is laid out under the paper rules measured for it: {printed}"
    );

    // The page is the height the page measured, plus a hair against rounding, and past the ceiling it is the ceiling with the document scaled onto it — never sheets, which a drawing cannot be split across. A proportional allowance was tried and on a document twenty screens tall it is most of a sheet of white below the last line.
    assert!(
        write.contains("let paper = paper_for((height + HAIR_OF_PAPER) / CSS_PIXELS_PER_INCH);")
            && write.contains(".SetPageHeight(paper.height)")
            && write.contains(".SetScaleFactor(paper.scale)")
            && write.contains(".SetPageWidth(inches(width) * paper.scale)"),
        "the page height is taken as given, and past the ceiling the whole page shrinks with the document: {write}"
    );
    assert!(
        write.contains("const HAIR_OF_PAPER: f64 = 4.0;"),
        "the allowance is a pixel count rather than a share of the document"
    );
    // Rounded up rather than down: a page a fraction shorter than what is laid out on it is a whole second page with almost nothing on it.
    assert!(
        write.contains("let height = (inches * 100.0).ceil() / 100.0;"),
        "the page is never rounded to less than the document needs"
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

/// The ceiling on a PDF page, and what a document past it comes out as: one page the ceiling tall with the whole document scaled onto it. Divided into equal sheets, a drawing under each cut was pushed whole onto the next sheet and the pushes added up to a fourth, nearly empty sheet under a three-sheet document. Both desktops ask it, so both desktops run this.
#[test]
fn a_document_taller_than_a_pdf_page_is_scaled_onto_one_page() {
    use crate::app::fileops::paper_for;

    // Under the ceiling it is its own height at full size, so one continuous page stays one continuous page.
    let own = paper_for(60.0);
    assert_eq!((own.height, own.scale), (60.0, 1.0));
    let edge = paper_for(200.0);
    assert_eq!((edge.height, edge.scale), (200.0, 1.0));

    // A hair over, and the answer is the ceiling with the document shrunk a hair to fit it, never two sheets.
    let hair = paper_for(202.0);
    assert_eq!(hair.height, 200.0);
    assert!((hair.scale - 200.0 / 202.0).abs() < 1e-9, "{}", hair.scale);
    // The document read on a running copy: 434 inches over a 200-inch ceiling.
    let read = paper_for(434.5);
    assert_eq!(read.height, 200.0);
    assert!((read.scale - 200.0 / 434.5).abs() < 1e-9, "{}", read.scale);
    // Nothing is ever asked for past the ceiling, and the scaled document always fits the page it was given, down to the smallest scale a renderer prints at.
    for tall in [1.0, 199.9, 200.1, 401.0, 1_999.0] {
        let paper = paper_for(tall);
        assert!(
            paper.height > 0.0 && paper.height <= 200.0,
            "{tall} gave a page {} tall",
            paper.height
        );
        assert!(
            (0.1..=1.0).contains(&paper.scale),
            "{tall} gave a scale of {}",
            paper.scale
        );
        assert!(
            tall * paper.scale <= paper.height + 0.01,
            "{tall} scaled by {} does not fit {}",
            paper.scale,
            paper.height
        );
    }
}

/// The picture export's own save window: the rows it offers and the name it suggests, on both platforms, since the window itself cannot be reached from here.
///
/// PNG leads on purpose, and that order is what a bare name becomes: Windows names a file with no ending off the first row, and a reader pressing Export on a picture wants a picture. The diagram's table leads with Markdown, so a copy of that order would be the wrong answer here.
#[test]
fn the_picture_save_window_leads_with_png_and_offers_what_the_host_writes() {
    let unasked = save_window_offer(PICTURE_EXPORT_FORMATS, None, "picture-menu");
    assert_eq!(
        unasked.filters,
        PICTURE_EXPORT_FORMATS.to_vec(),
        "a window nobody was asked ahead of dropped a format Windows offers in its dropdown"
    );
    assert_eq!(
        unasked.name, "picture-menu.png",
        "a bare name is no longer built off the first row, which is the whole reason PNG leads"
    );
    assert_eq!(
        PICTURE_EXPORT_FORMATS,
        &[
            ("PNG image", &["png"][..]),
            ("WebP image", &["webp"][..]),
            ("JPEG image", &["jpg", "jpeg"][..]),
            ("PDF document", &["pdf"][..]),
            ("Markdown", DocumentFormat::Markdown.extensions()),
        ],
        "the picture window offers a format the host does not write, or lists them in an order that names a bare file wrongly"
    );

    // One row and a name already wearing its ending, which is the whole of what a Mac panel can work from.
    for (label, endings) in PICTURE_EXPORT_FORMATS {
        for asked in *endings {
            for spelling in [asked.to_string(), asked.to_ascii_uppercase()] {
                let picked = save_window_offer(PICTURE_EXPORT_FORMATS, Some(&spelling), "shot");
                assert_eq!(
                    picked.filters,
                    vec![(*label, *endings)],
                    "a Mac panel asked with {spelling} was left more than the one row the reader picked"
                );
                assert_eq!(
                    picked.name,
                    format!("shot.{}", endings[0]),
                    "the reader picked {label} as {spelling} and the suggested name does not end in the row's first spelling"
                );
            }
        }
    }

    // Nothing the table names, so every row stands: a window that offered nothing is one a reader cannot save from at all.
    let unknown = save_window_offer(PICTURE_EXPORT_FORMATS, Some("gif"), "shot");
    assert_eq!(unknown.filters, PICTURE_EXPORT_FORMATS.to_vec());
    assert_eq!(unknown.name, "shot.png");
}

/// The name a copied picture takes in the `imgs` folder. An export that quietly replaced somebody's file is the one mistake here nobody can undo, so a taken name is written beside rather than over.
#[test]
fn a_picture_copied_into_imgs_is_written_beside_a_name_already_there() {
    let free = |taken: &[&str], name: &str| {
        let held: Vec<String> = taken.iter().map(|one| (*one).to_string()).collect();
        free_picture_name(name, &|candidate| held.iter().any(|one| one == candidate))
    };

    assert_eq!(
        free(&[], "shot.png"),
        "shot.png",
        "a free name was numbered"
    );
    assert_eq!(
        free(&["shot.png"], "shot.png"),
        "shot-2.png",
        "a second export wrote over the first"
    );
    assert_eq!(
        free(&["shot.png", "shot-2.png"], "shot.png"),
        "shot-3.png",
        "the number stops going up once one name beside it is taken"
    );
    // Two dots, so the number has to land before the last one rather than at the end of the whole name.
    assert_eq!(
        free(&["a.tar.gz"], "a.tar.gz"),
        "a.tar-2.gz",
        "a name with two dots was numbered past its ending"
    );
    // A dotfile is all ending and no stem, so numbering it on the dot would take its name away.
    assert_eq!(free(&[".hidden"], ".hidden"), ".hidden-2");
    assert_eq!(free(&["plain"], "plain"), "plain-2");
}

/// The one line a Markdown picture export writes, and the words it puts in the label.
#[test]
fn a_picture_document_carries_the_words_the_note_gave_it() {
    assert_eq!(
        picture_export_document("The find bar", "imgs/shot.png"),
        "![The find bar](imgs/shot.png)\n"
    );
    assert_eq!(
        picture_export_document("", "imgs/shot.png"),
        "![](imgs/shot.png)\n"
    );
    // A bracket of its own would close the label early and leave the rest of the words loose in the document.
    assert_eq!(
        markdown_alt_text("Before [after] end"),
        r"Before \[after\] end",
        "a bracket in the words was left to close the label"
    );
    assert_eq!(
        markdown_alt_text(r"a \ b"),
        r"a \\ b",
        "a backslash in the words was left to escape whatever came after it"
    );
    // A line break would end the paragraph the picture is in, so the picture and its words would come apart.
    assert_eq!(markdown_alt_text("first\nsecond"), "first second");
    assert_eq!(markdown_alt_text("first\r\nsecond"), "first  second");
    assert_eq!(markdown_alt_text("  padded  "), "padded");
}

/// The whole of the Markdown row, on a real folder: the document, the `imgs` folder beside it, and the picture copied in — then a second export of the same picture, which must land beside the first rather than over it.
#[test]
fn a_markdown_picture_export_writes_the_document_the_folder_and_the_copy() {
    let dir = std::env::temp_dir().join(format!("leaf-picture-export-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("the export folder is made");
    let source = dir.join("shot.png");
    std::fs::write(&source, b"the picture's own bytes").expect("the picture is written");

    let out = dir.join("out");
    std::fs::create_dir_all(&out).expect("the destination folder is made");
    let target = out.join("keeping this.md");
    export_picture_markdown(None, &target, &source, "The find bar");

    let images = out.join(PICTURE_EXPORT_IMAGE_DIR);
    assert!(
        images.is_dir(),
        "no imgs folder was made beside the document"
    );
    assert_eq!(
        std::fs::read(images.join("shot.png")).expect("the copy is there"),
        b"the picture's own bytes",
        "the picture beside the document is not the file it was copied from"
    );
    assert_eq!(
        std::fs::read_to_string(&target).expect("the document is there"),
        "![The find bar](imgs/shot.png)\n",
        "the document does not hold the picture and the words the note gave it"
    );

    // Again, into the same folder: the first copy has to still be there afterwards.
    let second = out.join("again.md");
    export_picture_markdown(None, &second, &source, "The find bar");
    assert_eq!(
        std::fs::read(images.join("shot.png")).expect("the first copy is still there"),
        b"the picture's own bytes",
        "a second export wrote over the picture the first one put there"
    );
    assert_eq!(
        std::fs::read(images.join("shot-2.png")).expect("the second copy is there"),
        b"the picture's own bytes",
        "the second export did not write its picture beside the first"
    );
    assert_eq!(
        std::fs::read_to_string(&second).expect("the second document is there"),
        "![The find bar](imgs/shot-2.png)\n",
        "the second document points at the first export's picture rather than its own"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// The PDF row is rendered by the host rather than encoded from anything the page sent, so the command that carries bytes must never write a file under that ending — a `.pdf` full of whatever else arrived is a file a reader cannot open and was told nothing about.
///
/// `print_picture_pdf` is what writes that row, and it needs a window, which is why what is held here is the other half: the bytes-carrying command leaves the path alone.
#[test]
fn a_picture_export_never_writes_a_pdf_or_a_format_the_window_never_offered() {
    let dir = std::env::temp_dir().join(format!("leaf-picture-rows-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("the folder is made");
    let source = dir.join("shot.png");
    std::fs::write(&source, b"the picture's own bytes").expect("the picture is written");

    for ending in ["pdf", "gif", "svg", "html", ""] {
        let target = dir.join(format!("out.{ending}"));
        export_picture(None, ending, &source, &target, "", "");
        assert!(
            !target.exists(),
            "a picture export under .{ending} wrote a file the window never offered it under"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
}

/// The two picture rows, on a real folder. A source already in the format asked for is copied rather than re-encoded — smaller, lossless and exact, where a round trip through the page's canvas is none of the three — and a conversion is the finished file the canvas wrote, written as it arrived.
#[test]
fn a_picture_already_in_the_format_asked_for_comes_out_byte_for_byte() {
    let dir = std::env::temp_dir().join(format!("leaf-picture-rows-2-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("the folder is made");

    // A real PNG's first bytes, so a file written from them reads as one.
    let png = b"\x89PNG\r\n\x1a\nthe picture's own bytes".to_vec();
    let source = dir.join("shot.png");
    std::fs::write(&source, &png).expect("the picture is written");

    // PNG out of a PNG: copied, and the data the page sent is not what lands.
    let target = dir.join("out.png");
    export_picture(None, "png", &source, &target, "", "bm90IHRoZSBmaWxl");
    assert_eq!(
        std::fs::read(&target).expect("the copy is there"),
        png,
        "a PNG exported as a PNG was re-encoded rather than copied, so it is a different file from the one on disk"
    );

    // The ending is read whatever case it is written in, or a `.PNG` would be re-encoded.
    let shouted = dir.join("SHOT.PNG");
    std::fs::write(&shouted, &png).expect("the picture is written");
    let out = dir.join("out-shouted.png");
    export_picture(None, "png", &shouted, &out, "", "bm90IHRoZSBmaWxl");
    assert_eq!(std::fs::read(&out).expect("the copy is there"), png);

    // WebP out of a PNG: a conversion, so what the canvas wrote is what is written.
    let webp = b"RIFF\x24\x00\x00\x00WEBPVP8 ".to_vec();
    let encoded = "UklGRiQAAABXRUJQVlA4IA==";
    let converted = dir.join("out.webp");
    export_picture(None, "webp", &source, &converted, "", encoded);
    assert_eq!(
        std::fs::read(&converted).expect("the converted file is there"),
        webp,
        "a converted picture is not the file the page's canvas wrote"
    );
    assert!(
        std::fs::read(&converted).unwrap().starts_with(b"RIFF"),
        "the file written under .webp does not read as a WebP"
    );

    // A payload that is not base64 at all: a half-decoded picture is worse than none, so nothing is written.
    let broken = dir.join("broken.webp");
    export_picture(None, "webp", &source, &broken, "", "not base64 *");
    assert!(
        !broken.exists(),
        "a payload that did not decode still wrote a file nobody can open"
    );
    let empty = dir.join("empty.webp");
    export_picture(None, "webp", &source, &empty, "", "");
    assert!(
        !empty.exists(),
        "a conversion that made no bytes still wrote an empty file"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// The JPEG row, which is the one whose format has two spellings. `jpg` is the word the row travels under and `jpeg` is a name a picture on disk may already wear, so the copy rule is asked of the row rather than of the one word — otherwise a `.jpeg` picked as a `.jpg` is re-encoded, which on a lossy source loses quality to make a bigger file.
#[test]
fn a_jpeg_picture_is_copied_under_either_spelling_and_a_conversion_is_what_the_page_sent() {
    let dir = std::env::temp_dir().join(format!("leaf-picture-rows-3-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("the folder is made");

    // A real JPEG's first bytes, so a file written from them reads as one.
    let jpeg = b"\xff\xd8\xff\xe0the picture's own bytes".to_vec();
    let encoded = "/9j/4HRoZSBwaWN0dXJlJ3Mgb3duIGJ5dGVz";

    // Every spelling a picture on disk may wear, asked for as the row's own word: copied, and the data the page sent is not what lands.
    for spelled in ["holiday.jpg", "holiday.jpeg", "HOLIDAY.JPEG"] {
        let source = dir.join(spelled);
        std::fs::write(&source, &jpeg).expect("the picture is written");
        let target = dir.join(format!("out-{spelled}"));
        export_picture(None, "jpg", &source, &target, "", "bm90IHRoZSBmaWxl");
        assert_eq!(
            std::fs::read(&target).expect("the copy is there"),
            jpeg,
            "{spelled} exported as a JPEG was re-encoded rather than copied, so it is a different file from the one on disk"
        );
    }

    // JPEG out of a PNG: a conversion, so what the page's canvas wrote is what is written.
    let png = dir.join("shot.png");
    std::fs::write(&png, b"\x89PNG\r\n\x1a\nthe picture's own bytes")
        .expect("the picture is written");
    let converted = dir.join("out.jpg");
    export_picture(None, "jpg", &png, &converted, "", encoded);
    assert_eq!(
        std::fs::read(&converted).expect("the converted file is there"),
        jpeg,
        "a converted picture is not the file the page's canvas wrote"
    );
    assert!(
        std::fs::read(&converted)
            .unwrap()
            .starts_with(b"\xff\xd8\xff"),
        "the file written under .jpg does not read as a JPEG"
    );

    // The reader typed the other spelling into the save window, which Windows keeps where the chosen row permits it: the same row, so the same file.
    let spelled = dir.join("out.jpeg");
    export_picture(None, "jpg", &png, &spelled, "", encoded);
    assert_eq!(
        std::fs::read(&spelled).expect("the converted file is there"),
        jpeg,
        "a name typed with the row's other spelling wrote something else"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
