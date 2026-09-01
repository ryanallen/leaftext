//! Word, Excel, PowerPoint and OpenDocument files: how they arrive, how they read, and what a save owes the archive they came out of.
//!
//! **The documents these tests read are built here, by the same code the owner opens.** Nothing in this tree ships an Office file and nothing here had one — the only `.docx` in the suite is eight bytes of nonsense proving a refusal — so a reader test would otherwise assert against a fixture nobody could open, and a broken reader would be indistinguishable from a broken fixture. `just make-test-docs` writes these six out where a person can open them in Word and Excel, which is what the owner's box presses.

use super::*;
use crate::office::testing::{
    any_local_header_defers_its_sizes, archive, archive_deferring_every_size,
    archive_with_data_descriptor, archive_with_directory_entries, blocks, member_bytes,
    member_names, read_archive_member, written_archive,
};

// ---------------------------------------------------------------------------
// How a document arrives
// ---------------------------------------------------------------------------

/// The nine formats somebody types are still decoded on the way in, and only the six packaged ones arrive as the bytes on disk. A text format that quietly moved onto the byte path would stop being spelled back the way it came.
#[test]
fn only_the_packaged_formats_arrive_as_bytes() {
    for format in DocumentFormat::ALL {
        let packaged = matches!(
            format,
            DocumentFormat::Docx
                | DocumentFormat::Xlsx
                | DocumentFormat::Pptx
                | DocumentFormat::Odt
                | DocumentFormat::Ods
                | DocumentFormat::Odp
        );
        let wanted = if packaged {
            SourceShape::Bytes
        } else {
            SourceShape::Text
        };
        assert_eq!(
            format.source_shape(),
            wanted,
            "{} arrives the wrong way round",
            format.display_name()
        );
    }
}

/// The loader now reads bytes and asks one table what they mean, so a text document has to come out of that table exactly as it came out of the decode-then-render pair it replaced.
#[test]
fn a_text_document_renders_the_same_from_its_bytes_as_from_its_text() {
    let source = "# Heading\n\nA paragraph with a [link](other.md).\n";
    let path = Path::new("note.md");
    let from_bytes = opened_document_from_bytes(source.as_bytes(), path).expect("renders");
    let from_text = opened_document_from_source(source, path);
    assert_eq!(from_bytes.html, from_text.html);
    assert_eq!(from_bytes.source, from_text.source);
    assert_eq!(from_bytes.format, from_text.format);
}

/// A file's spelling is a fact about the file, and the byte path is where it is now learned. A UTF-16 document with a mark has to arrive as its words rather than as every other byte being a zero.
#[test]
fn the_byte_path_still_decodes_by_the_mark() {
    let mut bytes = vec![0xFF, 0xFE];
    for unit in "# Wide\n".encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    let opened = opened_document_from_bytes(&bytes, Path::new("wide.md")).expect("renders");
    assert!(
        opened.html.contains("Wide"),
        "a marked UTF-16 document should decode: {}",
        opened.html
    );
}

/// The zero-byte refusal is what stops a binary opening as a page of noise, and moving the loader onto bytes must not have loosened it for any format that is still read as text.
#[test]
fn a_zero_byte_still_refuses_every_text_format() {
    let binary = b"\x89PNG\x00\x1a\n not a document at all";
    for format in DocumentFormat::ALL {
        if format.source_shape() == SourceShape::Bytes {
            continue;
        }
        let Some(extension) = format.extensions().first() else {
            continue;
        };
        let path = PathBuf::from(format!("thing.{extension}"));
        let refusal = opened_document_from_bytes(binary, &path)
            .expect_err("a file holding a zero byte is not text");
        assert!(
            refusal.to_string().contains("zero byte"),
            "{} should still refuse a zero byte, said: {refusal}",
            format.display_name()
        );
    }
}

/// A document with no mark and no valid UTF-8 is some legacy code page, and that has always opened as Windows-1252 rather than failing. The byte path keeps that bargain: losing a file's text is worse than showing it imperfectly.
#[test]
fn the_byte_path_still_opens_a_legacy_code_page() {
    let bytes = b"# Caf\xe9\n";
    let opened = opened_document_from_bytes(bytes, Path::new("legacy.md")).expect("renders");
    assert!(
        opened.source.contains("Café"),
        "Windows-1252 should still decode: {}",
        opened.source
    );
}

/// The half of the phase-1 test that had no byte-shaped format to run against until the six arrived: what a reader is handed is the file, not a decoded copy of it. A package holds bytes that are not text at all, so anything that decoded on the way in would arrive damaged.
#[test]
fn a_byte_shaped_format_reaches_its_reader_with_the_files_bytes_intact() {
    let bytes = sample_docx();
    let member = read_archive_member(&bytes, "word/document.xml").expect("the document member");
    assert!(
        member.contains("Sales rose in every region"),
        "the reader was handed something other than the file"
    );
    let opened = opened_document_from_bytes(&bytes, Path::new("report.docx")).expect("renders");
    assert!(opened.html.contains("Sales rose in every region"));
}

// ---------------------------------------------------------------------------
// Reading the six
// ---------------------------------------------------------------------------

/// Every one of the six opens and says what it holds. One sample each, built by the same code the owner opens in Word.
#[test]
fn each_of_the_six_renders() {
    for (name, bytes, wanted) in every_sample() {
        let opened = opened_document_from_bytes(&bytes, Path::new(&name))
            .unwrap_or_else(|error| panic!("{name} should open: {error}"));
        for words in wanted {
            assert!(
                opened.html.contains(words),
                "{name} should say {words:?}, drew: {}",
                opened.html
            );
        }
    }
}

/// A range is a promise: the reading view splices what it is given back over exactly those bytes, so a range that is off by one corrupts somebody's document. Every range a reader stamps has to cut the block's own words out of the member it names.
#[test]
fn a_range_stamped_on_a_block_really_is_that_blocks_bytes() {
    for (name, bytes, _) in every_sample() {
        let format = DocumentFormat::from_path(Path::new(&name));
        let blocks = blocks(&bytes, format).unwrap_or_else(|| panic!("{name} should read"));
        let mut proved = 0usize;
        let mut words_proved = 0usize;
        for block in &blocks {
            let Some(at) = block.at() else {
                continue;
            };
            let member =
                read_archive_member(&bytes, &at.member).expect("a block names a real member");
            let slice = &member[at.range.clone()];
            // The slice has to be one whole element, not a run of one, or a splice would leave a torn tag behind.
            assert!(
                is_one_whole_element(slice),
                "{name}: {} bytes {:?} are not one whole element",
                at.member,
                at.range
            );
            let words = block.text();
            let first = words.split_whitespace().next().unwrap_or_default();
            if !first.is_empty() && member.contains(first) {
                assert!(
                    slice.contains(first),
                    "{name}: {} holds {first:?} and {:?} is not where it is",
                    at.member,
                    at.range
                );
                words_proved += 1;
            }
            proved += 1;
        }
        assert!(proved > 0, "{name} proved no ranges at all");
        if format == DocumentFormat::Xlsx {
            // The one sample whose words are not in the member its blocks anchor to: every text cell in a workbook takes its text from `xl/sharedStrings.xml`, which is the fact the whole shared-string decision rests on.
            assert_eq!(
                words_proved, 0,
                "{name} was expected to keep its words elsewhere"
            );
            let sheet = read_archive_member(&bytes, "xl/worksheets/sheet1.xml").expect("the sheet");
            assert!(sheet.contains("r=\"A1\" t=\"s\""));
            assert!(!sheet.contains("Region"));
        } else {
            assert!(words_proved > 0, "{name} proved no block's own words");
        }
    }
}

/// A sheet is drawn as a record table, through the drawing every other structured format in this app already reads as. Nothing new is styled, so `just check-classes` finds nothing to account for.
#[test]
fn a_sheet_renders_as_a_record_table() {
    for (name, bytes) in [("budget.xlsx", sample_xlsx()), ("sheet.ods", sample_ods())] {
        let opened = opened_document_from_bytes(&bytes, Path::new(name)).expect("opens");
        assert!(
            opened.html.contains("<table class=\"data-table\""),
            "{name} should draw a record table, drew: {}",
            opened.html
        );
        assert!(
            opened.html.contains("data-leaf-col="),
            "{name}'s cells should carry their column the way every other record table's do"
        );
    }
}

/// The code view shows the member the document is anchored to, colored through the XML path that already exists. A Word file's source is `word/document.xml`, not the zip around it.
#[test]
fn the_code_view_colors_the_anchored_members_xml() {
    let folder = scratch_dir("office-code-view");
    let path = folder.join("report.docx");
    std::fs::write(&path, sample_docx()).expect("the sample is written");
    let source = read_document_source(&path).expect("a package has a source");
    assert!(
        source.text.starts_with("<?xml"),
        "the code view should be shown XML, was shown: {}",
        &source.text[..source.text.len().min(40)]
    );
    assert!(source.text.contains("<w:body>"));
    assert_eq!(DocumentFormat::Docx.language_token(), "xml");
}

/// A vault of Word files is searchable rather than listed and empty: the corpus reads what the document says, not the zip the words are packed in.
#[test]
fn a_vault_reads_a_word_files_words() {
    let words = crate::office::document_text(&sample_docx(), DocumentFormat::Docx)
        .expect("a Word file has words");
    assert!(words.contains("Sales rose in every region"));
    assert!(
        !words.contains("<w:t>"),
        "search should index the words, not the markup: {words}"
    );
}

// ---------------------------------------------------------------------------
// What the archive reader has to survive
// ---------------------------------------------------------------------------

/// The four shapes a real package turns up in, each read back to exactly the bytes that went in. Two of them break a reader that trusts the local header, and one breaks a reader that assumes deflate.
#[test]
fn every_shape_a_real_package_carries_reads_back_to_the_same_bytes() {
    let words = "<x>a member long enough that deflating it is worth doing at all</x>";
    for (shape, bytes) in [
        ("deflated", written_archive(&[("part.xml", words, false)])),
        ("stored", written_archive(&[("part.xml", words, true)])),
        (
            "directory entries",
            archive_with_directory_entries("part.xml", words),
        ),
        (
            "a trailing data descriptor",
            archive_with_data_descriptor("part.xml", words),
        ),
    ] {
        assert_eq!(
            read_archive_member(&bytes, "part.xml").as_deref(),
            Some(words),
            "a member written {shape} did not read back"
        );
        assert_eq!(
            member_names(&bytes),
            vec!["part.xml".to_string()],
            "reading a member written {shape} listed the wrong members"
        );
    }
}

/// A member the app never opened comes back out of a rewrite byte for byte, and the rewrite carries no data descriptor of its own — a copy that keeps the flag while dropping the descriptor is read happily by a lenient reader and refused as corrupt by the package layer Office itself is built on.
#[test]
fn rewriting_one_member_leaves_the_others_alone_and_defers_no_sizes() {
    let before = sample_docx();
    let after = archive(&before)
        .with_member_replaced("word/document.xml", b"<w:document/>")
        .expect("the member is replaced");
    assert_eq!(
        read_archive_member(&after, "word/document.xml").as_deref(),
        Some("<w:document/>")
    );
    for member in [
        "word/styles.xml",
        "word/numbering.xml",
        "[Content_Types].xml",
    ] {
        assert_eq!(
            read_archive_member(&after, member),
            read_archive_member(&before, member),
            "{member} was not left alone"
        );
    }
    assert!(
        !any_local_header_defers_its_sizes(&after),
        "a written archive must put its sizes in front of the data"
    );
}

// ---------------------------------------------------------------------------
// What a package that cannot be read does
// ---------------------------------------------------------------------------

/// A `.docx` whose bytes are not an archive says so and opens nothing. Rendering zip noise as Markdown — which is what the total fallback would do — draws a page of gibberish and calls it a document.
#[test]
fn a_word_file_that_is_not_a_zip_says_so_rather_than_panicking() {
    let refusal = opened_document_from_bytes(b"not a zip at all", Path::new("broken.docx"))
        .expect_err("a file that is not an archive cannot open");
    assert!(
        refusal.to_string().contains("archive"),
        "the refusal should say what is wrong: {refusal}"
    );
}

/// An archive that is a real zip but holds none of the parts a Word file has is refused for that reason, rather than opening as an empty document.
#[test]
fn a_package_missing_the_part_it_is_named_for_opens_nothing() {
    let bytes = written_archive(&[("readme.txt", "not a Word file", false)]);
    let refusal = opened_document_from_bytes(&bytes, Path::new("empty.docx"))
        .expect_err("an archive with no document part cannot open");
    assert!(
        refusal.to_string().contains("word/document.xml"),
        "the refusal should name the missing part: {refusal}"
    );
}

/// A package is read here and not written yet, and the guard is at the one place a document leaves the app: writing an edit buffer over a `.docx` would replace a Word document with the XML of one member.
#[test]
fn a_package_is_never_written_over_as_text() {
    let folder = scratch_dir("office-save-refusal");
    let path = folder.join("report.docx");
    std::fs::write(&path, sample_docx()).expect("the sample is written");
    let before = std::fs::read(&path).expect("read back");
    let refusal = DesktopHost::default()
        .save(&path, &SourceText::utf8("<w:document/>".to_string()))
        .expect_err("a package cannot be saved as text");
    assert!(
        refusal.to_string().contains("not written yet"),
        "the refusal should say why: {refusal}"
    );
    assert_eq!(
        std::fs::read(&path).expect("read back"),
        before,
        "the file must not have been touched"
    );
}

/// Whether a slice is exactly one element: it opens with a tag and closes with that tag's own end, so splicing over it leaves nothing torn. Parsing it is not the test — a fragment cut out of a package carries namespace prefixes whose declarations are up on the root, so every one of them would refuse on its own.
fn is_one_whole_element(slice: &str) -> bool {
    let Some(rest) = slice.strip_prefix('<') else {
        return false;
    };
    let name: String = rest
        .chars()
        .take_while(|character| {
            !character.is_whitespace() && *character != '>' && *character != '/'
        })
        .collect();
    !name.is_empty() && (slice.ends_with(&format!("</{name}>")) || slice.ends_with("/>"))
}

// ---------------------------------------------------------------------------
// Editing and saving
// ---------------------------------------------------------------------------

/// A package opened, edited and written back the way the app does it: one buffer, one splice, one save.
///
/// `edit` is handed the buffer, so a test writes what a reader would write rather than composing an archive of its own.
fn saved_after(name: &str, bytes: &[u8], edit: impl FnOnce(&mut EditableDocument)) -> Vec<u8> {
    let folder = scratch_dir("office-save");
    let path = folder.join(name);
    std::fs::write(&path, bytes).expect("the sample is written");
    let source = read_document_for_editing(&path).expect("a package opens for editing");
    let mut buffer = EditableDocument::over_package(
        path.clone(),
        source.text,
        source.package.expect("a package carries its archive"),
    );
    edit(&mut buffer);
    save_editable_document(&DesktopHost::default(), &buffer).expect("the package is written back");
    std::fs::read(&path).expect("the saved file reads")
}

/// A word typed into a Word document is on the page before it is saved, the way a word typed into a note is. Drawing a package from its file instead is what the first build did, and a reader who typed one watched nothing happen until they pressed Save.
#[test]
fn an_unsaved_edit_to_a_package_is_on_the_page_before_it_is_saved() {
    let bytes = sample_docx();
    let member = "word/document.xml";
    let text = read_archive_member(&bytes, member).expect("the body");
    let mut buffer = EditableDocument::over_package(
        PathBuf::from("report.docx"),
        SourceText::utf8(text.clone()),
        PackageBuffer {
            bytes,
            member: member.to_string(),
        },
    );
    let at = text.find("north").expect("the word is there");
    buffer.replace_range(at, at + "north".len(), "far north");

    let drawn = opened_document_from_buffer_with_host(
        &buffer,
        Path::new("report.docx"),
        &DesktopHost::default(),
    )
    .expect("a package draws from its buffer");
    assert!(
        drawn.html.contains("the far north led it."),
        "an unsaved edit should be on the page: {}",
        drawn.html
    );
    assert!(
        buffer.is_dirty(),
        "drawing a package must not quietly mark it saved"
    );
}

/// A package opened, its buffer seeded with the member the page is given: what the app holds the moment a reader clicks into a Word file, before they have typed anything.
fn buffer_over(name: &str, bytes: Vec<u8>) -> (PathBuf, EditableDocument) {
    let path = PathBuf::from(name);
    let format = DocumentFormat::from_path(&path);
    let (source, member) =
        crate::office::anchored_member_source(&bytes, &path, format).expect("the sample opens");
    let buffer =
        EditableDocument::over_package(path.clone(), source, PackageBuffer { bytes, member });
    (path, buffer)
}

/// A render from a buffer draws exactly what building the whole archive again and reading it back drew. The member override is only ever an answer the archive could have given itself, so the two paths agreeing is what says the shortcut took nothing out — asked of all six formats, because each reads a different set of members.
#[test]
fn a_package_drawn_from_its_buffer_draws_what_a_rebuilt_archive_drew() {
    let host = DesktopHost::default();
    for (name, bytes, _) in every_sample() {
        let (path, buffer) = buffer_over(&name, bytes.clone());
        let package = buffer.package().expect("a package carries its archive");
        let rebuilt = crate::office::archive_with_member(&bytes, &package.member, buffer.text())
            .expect("the archive is written again");

        assert_eq!(
            opened_document_from_buffer_with_host(&buffer, &path, &host)
                .expect("a package draws from its buffer"),
            opened_document_from_bytes_with_host(&rebuilt, &path, &host)
                .expect("the rebuilt archive draws"),
            "{name} drew differently from its buffer than from an archive rebuilt around it"
        );
    }
}

/// A reader opens more members than the one the buffer holds — Word reads `word/numbering.xml` to know whether a list draws numbers, and Excel reads `xl/sharedStrings.xml` for the words almost every cell only points at. Those still come out of the archive the buffer arrived with, so an edit shows up without costing the document its lists or its cell text.
#[test]
fn a_buffer_render_still_reads_the_members_beside_the_one_it_holds() {
    let host = DesktopHost::default();

    let (path, mut buffer) = buffer_over("report.docx", sample_docx());
    let at = buffer
        .text()
        .find("Sales")
        .expect("the paragraph is in the buffer");
    buffer.replace_range(at, at + "Sales".len(), "Takings");
    let drawn = opened_document_from_buffer_with_host(&buffer, &path, &host)
        .expect("a Word file draws from its buffer");
    assert!(
        drawn.html.contains("Takings rose in every region"),
        "the edit should be on the page: {}",
        drawn.html
    );
    assert!(
        drawn.html.contains("<ol>"),
        "the numbered point is numbered by word/numbering.xml, which the buffer does not hold: {}",
        drawn.html
    );

    let (path, mut buffer) = buffer_over("budget.xlsx", sample_xlsx());
    // A workbook keeps almost every cell's words in the shared table, so a cell is typed on by rewriting the cell element itself.
    let cell = "<c r=\"C2\" t=\"s\"><v>5</v></c>";
    let at = buffer.text().find(cell).expect("the cell is in the sheet");
    assert!(buffer.replace_sheet_cell(at, at + cell.len(), "Closed"));
    let drawn = opened_document_from_buffer_with_host(&buffer, &path, &host)
        .expect("a workbook draws from its buffer");
    assert!(
        drawn.html.contains("Closed"),
        "the edited cell should be on the page: {}",
        drawn.html
    );
    assert!(
        drawn.html.contains("Region") && drawn.html.contains("North"),
        "the cells pointing at xl/sharedStrings.xml should still say their words: {}",
        drawn.html
    );
}

/// A save writes the same archive however many times the page was drawn on the way. The render stopped building one, and what it must not have done is quietly change what the save builds — so this is the byte-for-byte demand made again, after the buffer has been rendered.
#[test]
fn a_save_after_a_render_still_writes_every_part_byte_for_byte() {
    let before = sample_docx();
    let host = DesktopHost::default();
    let after = saved_after("report.docx", &before, |buffer| {
        let at = buffer
            .text()
            .find("Sales rose in every region")
            .expect("the paragraph is in the buffer");
        buffer.replace_range(at, at + "Sales".len(), "Takings");
        for _ in 0..3 {
            opened_document_from_buffer_with_host(buffer, Path::new("report.docx"), &host)
                .expect("a package draws from its buffer");
        }
    });

    assert!(read_archive_member(&after, "word/document.xml")
        .expect("the body")
        .contains("Takings rose in every region"));
    for part in [
        "word/styles.xml",
        "word/numbering.xml",
        "word/theme/theme1.xml",
        "word/comments.xml",
        "word/charts/chart1.xml",
        "word/_rels/document.xml.rels",
        CONTENT_TYPES,
    ] {
        assert_eq!(
            member_bytes(&after, part),
            member_bytes(&before, part),
            "{part} did not survive a save taken after a render"
        );
    }
}

/// The read a caller already took is the only read there is. Handed a package's bytes, the entry draws them for a path with no file behind it at all — which a second read of that path could not survive, so this is what proves the second read is gone rather than restating that it was removed.
#[test]
fn a_package_draws_for_a_path_with_no_file_behind_it() {
    let bytes = sample_docx();
    let path = scratch_dir("office-unread").join("never-written.docx");
    assert!(
        !path.exists(),
        "the point of the path is that nothing is there"
    );
    let (text, member) = crate::office::anchored_member_source(&bytes, &path, DocumentFormat::Docx)
        .expect("the sample opens");
    let source = DocumentSource {
        text,
        package: Some(PackageBuffer { bytes, member }),
    };

    let drawn = opened_document_for_path_with_host(&path, &source, &DesktopHost::default())
        .expect("a package draws from the bytes already in hand");
    assert!(
        drawn.html.contains("Sales rose in every region"),
        "the document should be on the page: {}",
        drawn.html
    );
}

/// A package's identity, read over the whole of it — the shape the app's own gate reads off the tail alone.
fn identity(bytes: &[u8]) -> Option<u64> {
    crate::office::package_identity(bytes, 0)
}

/// What a package's directory says about every member is the answer to whether the file moved: it holds across a second reading and moves whenever any member's bytes do — including a member nothing in the app parses, which a hash of the anchored member's text alone could never see. Asked of the six samples, of the same bytes read off a tail rather than the whole file, and of an archive that defers its sizes to trailing descriptors, since the directory is the one place they are always true.
#[test]
fn a_packages_identity_moves_when_a_member_does_and_holds_when_none_do() {
    for (name, bytes, _) in every_sample() {
        let before = identity(&bytes).unwrap_or_else(|| panic!("{name} states its own identity"));
        assert_eq!(
            Some(before),
            identity(&bytes),
            "{name} read its identity two different ways"
        );

        let path = PathBuf::from(&name);
        let (source, member) =
            crate::office::anchored_member_source(&bytes, &path, DocumentFormat::from_path(&path))
                .expect("the sample opens");
        let edited =
            crate::office::archive_with_member(&bytes, &member, &format!("{} ", source.text))
                .expect("the member is written back");
        assert_ne!(
            Some(before),
            identity(&edited),
            "{name}'s identity should move when a member's bytes do"
        );

        // The directory is at the end and its offsets are written from the front, so a reading that starts partway in has to be told where it started.
        let tail_at = 64.min(bytes.len());
        assert_eq!(
            Some(before),
            crate::office::package_identity(&bytes[tail_at..], tail_at),
            "{name} should read the same off a tail as off the whole file"
        );
        let too_short = bytes.len() - 8;
        assert_eq!(
            None,
            crate::office::package_identity(&bytes[too_short..], too_short),
            "{name}: a tail with no room for the record answers nothing, so the caller reads more"
        );
    }

    let bytes = sample_docx();
    let styles = read_archive_member(&bytes, "word/styles.xml").expect("the styles");
    let restyled =
        crate::office::archive_with_member(&bytes, "word/styles.xml", &format!("{styles} "))
            .expect("the styles are written back");
    assert_ne!(
        identity(&bytes),
        identity(&restyled),
        "a member the reader never opens still moves the file"
    );

    let deferred = archive_with_data_descriptor("word/document.xml", "<w:document/>");
    let other = archive_with_data_descriptor("word/document.xml", "<w:document />");
    assert!(
        identity(&deferred).is_some(),
        "a package deferring its sizes still states an identity, because the directory carries them"
    );
    assert_ne!(identity(&deferred), identity(&other));
}

/// Everything the app never parsed comes back byte for byte: the styles, the theme, the comments, the tracked change and the chart. That is the whole bargain of only ever rewriting a range you can prove — a member nothing understood is a member nothing rewrote.
#[test]
fn every_part_the_app_never_read_survives_a_save_byte_for_byte() {
    let before = sample_docx();
    let after = saved_after("report.docx", &before, |buffer| {
        let at = buffer
            .text()
            .find("Sales rose in every region")
            .expect("the paragraph is in the buffer");
        buffer.replace_range(at, at + "Sales".len(), "Takings");
    });

    assert!(read_archive_member(&after, "word/document.xml")
        .expect("the body")
        .contains("Takings rose in every region"));
    for part in [
        "word/styles.xml",
        "word/numbering.xml",
        "word/theme/theme1.xml",
        "word/comments.xml",
        "word/charts/chart1.xml",
        "word/_rels/document.xml.rels",
        "[Content_Types].xml",
    ] {
        assert_eq!(
            member_bytes(&after, part),
            member_bytes(&before, part),
            "{part} did not survive the save"
        );
    }
    // The tracked change is in the member that *was* rewritten, and it has to come through the splice untouched all the same.
    assert!(read_archive_member(&after, "word/document.xml")
        .expect("the body")
        .contains("A sentence somebody added with track changes on."));
}

/// A saved package still opens as the document it was. There is no Word on this machine to ask, so what is asked instead is the two things Word asks first: every part is still readable out of the package, and the app's own reader draws the document again with the edit in it.
#[test]
fn a_saved_package_still_opens_as_the_document_it_was() {
    let before = sample_docx();
    let after = saved_after("report.docx", &before, |buffer| {
        let at = buffer.text().find("north").expect("the word is there");
        buffer.replace_range(at, at + "north".len(), "south");
    });

    assert_eq!(
        member_names(&after),
        member_names(&before),
        "a save must not add or drop a part"
    );
    for part in member_names(&after) {
        assert!(
            member_bytes(&after, &part).is_some(),
            "{part} cannot be read back out of the saved package"
        );
    }
    let opened = opened_document_from_bytes(&after, Path::new("report.docx")).expect("opens");
    assert!(opened
        .html
        .contains("Sales rose in every region, and the south led it."));
}

/// An OpenDocument file says what it is by its first member, stored uncompressed at byte 38 where a format sniffer looks. Only the member being written is rewritten and nothing is reordered, so that holds by construction rather than by luck — and this is what says so out loud.
#[test]
fn an_open_document_file_still_says_what_it_is_after_a_save() {
    let before = sample_odt();
    let after = saved_after("letter.odt", &before, |buffer| {
        let at = buffer.text().find("north").expect("the word is there");
        buffer.replace_range(at, at + "north".len(), "south");
    });

    assert_eq!(
        member_names(&after).first().map(String::as_str),
        Some("mimetype"),
        "mimetype must stay the first member"
    );
    let mime = b"application/vnd.oasis.opendocument.text";
    assert_eq!(
        after.get(38..38 + mime.len()),
        Some(&mime[..]),
        "the mime type must stay stored, uncompressed, at byte 38"
    );
    assert!(read_archive_member(&after, "content.xml")
        .expect("the content")
        .contains("the south led it"));
}

/// A workbook is the one document whose words are not in the member the buffer holds: every text cell takes its text from `xl/sharedStrings.xml`. So a cell is edited by rewriting the cell element to say its words inline, which leaves a string two cells share exactly as it was — and the cell nobody typed in still reads what it always read.
#[test]
fn editing_a_shared_string_cell_leaves_the_cell_beside_it_alone() {
    let before = sample_xlsx();
    let after = saved_after("budget.xlsx", &before, |buffer| {
        let cell = "<c r=\"C2\" t=\"s\"><v>5</v></c>";
        let at = buffer.text().find(cell).expect("the cell is in the sheet");
        assert!(
            buffer.replace_sheet_cell(at, at + cell.len(), "Closed"),
            "a cell element should be rewritten as an inline string"
        );
    });

    assert_eq!(
        member_bytes(&after, "xl/sharedStrings.xml"),
        member_bytes(&before, "xl/sharedStrings.xml"),
        "the shared string table must not be touched"
    );
    let sheet = read_archive_member(&after, "xl/worksheets/sheet1.xml").expect("the sheet");
    assert!(
        sheet.contains(
            "<c r=\"C2\" t=\"inlineStr\"><is><t xml:space=\"preserve\">Closed</t></is></c>"
        ),
        "the edited cell should say its words inline: {sheet}"
    );
    assert!(
        sheet.contains("<c r=\"C3\" t=\"s\"><v>5</v></c>"),
        "the cell that shared the string must be left pointing at it: {sheet}"
    );

    let opened = opened_document_from_bytes(&after, Path::new("budget.xlsx")).expect("opens");
    assert!(opened.html.contains("Closed"));
    assert!(
        opened.html.contains("Open"),
        "the other cell still reads the string they shared: {}",
        opened.html
    );
}

/// A second cell typed in the same session is rewritten like the first. The rewrite answers whether it wrote rather than whether the dirty flag moved, which a buffer already dirty never moves again — read the wrong one and the caller's fallback splices over the cell just written, taking the rest of the row with it.
#[test]
fn a_second_cell_typed_in_one_session_is_rewritten_like_the_first() {
    let before = sample_xlsx();
    let after = saved_after("budget.xlsx", &before, |buffer| {
        for (cell, words) in [
            ("<c r=\"C2\" t=\"s\"><v>5</v></c>", "Closed"),
            ("<c r=\"C3\" t=\"s\"><v>5</v></c>", "Open again"),
        ] {
            let at = buffer.text().find(cell).expect("the cell is in the sheet");
            assert!(
                buffer.replace_sheet_cell(at, at + cell.len(), words),
                "a cell element should be rewritten as an inline string, dirty or clean"
            );
        }
    });

    let sheet = read_archive_member(&after, "xl/worksheets/sheet1.xml").expect("the sheet");
    assert!(
        sheet.contains(
            "<c r=\"C2\" t=\"inlineStr\"><is><t xml:space=\"preserve\">Closed</t></is></c>"
        ),
        "the first cell should still say its words inline: {sheet}"
    );
    assert!(
        sheet.contains(
            "<c r=\"C3\" t=\"inlineStr\"><is><t xml:space=\"preserve\">Open again</t></is></c>"
        ),
        "the second cell should say its words inline rather than being spliced over: {sheet}"
    );
    assert_eq!(
        member_bytes(&after, "xl/sharedStrings.xml"),
        member_bytes(&before, "xl/sharedStrings.xml"),
        "the shared string table must not be touched by either edit"
    );
    let opened = opened_document_from_bytes(&after, Path::new("budget.xlsx")).expect("opens");
    assert!(opened.html.contains("Closed"));
    assert!(opened.html.contains("Open again"));
}

/// A package whose members write their sizes after the data is the shape two of three real Word documents carry, and a copy that keeps the flag while dropping the descriptor is read happily by a lenient reader and refused as corrupt by the package layer Office is built on. Every member the edit did not touch comes through byte for byte, and none of them defers its sizes.
#[test]
fn a_package_written_with_data_descriptors_opens_after_a_save() {
    let before = docx_with_data_descriptors();
    assert!(
        any_local_header_defers_its_sizes(&before),
        "the fixture is meant to carry the shape being tested"
    );
    let after = saved_after("descriptors.docx", &before, |buffer| {
        let at = buffer.text().find("north").expect("the word is there");
        buffer.replace_range(at, at + "north".len(), "south");
    });

    assert!(!any_local_header_defers_its_sizes(&after));
    assert_eq!(member_names(&after), member_names(&before));
    for part in member_names(&after) {
        if part == "word/document.xml" {
            continue;
        }
        assert_eq!(
            member_bytes(&after, &part),
            member_bytes(&before, &part),
            "{part} did not survive the save"
        );
    }
    let opened = opened_document_from_bytes(&after, Path::new("descriptors.docx")).expect("opens");
    assert!(opened.html.contains("the south led it"));
}

/// The Word sample again, every member written with its sizes in a trailing data descriptor — the shape our own writer never writes, so it has to be built by hand.
fn docx_with_data_descriptors() -> Vec<u8> {
    let sample = sample_docx();
    let members: Vec<(String, Vec<u8>)> = member_names(&sample)
        .into_iter()
        .map(|name| {
            let bytes = member_bytes(&sample, &name).expect("every member reads");
            (name, bytes)
        })
        .collect();
    let borrowed: Vec<(&str, &[u8])> = members
        .iter()
        .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
        .collect();
    archive_deferring_every_size(&borrowed)
}

// ---------------------------------------------------------------------------
// The six sample documents
// ---------------------------------------------------------------------------

/// Every sample, with its name and a few of the words it must be able to say. One list, so a test that walks the six cannot walk five.
fn every_sample() -> Vec<(String, Vec<u8>, Vec<&'static str>)> {
    vec![
        (
            "report.docx".to_string(),
            sample_docx(),
            vec![
                "Quarterly report",
                "Sales rose in every region",
                "A numbered point",
                "North",
            ],
        ),
        (
            "budget.xlsx".to_string(),
            sample_xlsx(),
            vec!["Region", "North", "Open"],
        ),
        (
            "deck.pptx".to_string(),
            sample_pptx(),
            vec!["What we shipped", "One slide is not a deck"],
        ),
        (
            "letter.odt".to_string(),
            sample_odt(),
            vec!["Quarterly report", "Sales rose in every region"],
        ),
        (
            "sheet.ods".to_string(),
            sample_ods(),
            vec!["Region", "North"],
        ),
        (
            "slides.odp".to_string(),
            sample_odp(),
            vec!["What we shipped", "One slide is not a deck"],
        ),
    ]
}

/// Writes the six sample documents into the plan tree and prints where they went, for somebody who wants to open one in Word or read it in Leaftext.
///
/// They go beside the other sample documents the owner already opens — a feed, a message, a TEI file — because that is the tree the tickets are read in and the folder somebody would look in. Ignored on purpose: `just verify` neither writes them nor reads them, and `just make-test-docs` is the recipe that runs this one test. Every byte of the builders sits behind `#[cfg(test)]`, so none of it is in the app.
#[test]
#[ignore = "writes files; run it with `just make-test-docs`"]
fn make_test_docs() {
    let folder = std::env::current_dir()
        .expect("a working folder")
        .join("..")
        .join("docs")
        .join("tests")
        .join("office");
    std::fs::create_dir_all(&folder).expect("the folder is made");
    for (name, bytes, _) in every_sample() {
        let path = folder.join(&name);
        std::fs::write(&path, &bytes).unwrap_or_else(|error| panic!("{name}: {error}"));
    }
    // Said as a path somebody can paste, which the one this walked up out of is not; Windows answers a canonical path with a prefix nothing else wants to see.
    let said = std::fs::canonicalize(&folder).unwrap_or(folder);
    let said = said.display().to_string();
    println!(
        "Six sample documents are in {}",
        said.strip_prefix(r"\\?\").unwrap_or(&said)
    );
}

const CONTENT_TYPES: &str = "[Content_Types].xml";

/// A Word document: a title, a heading, a paragraph written as three runs the way Word splits one, a bulleted item, a numbered item and a table.
pub(super) fn sample_docx() -> Vec<u8> {
    let body = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>What happened</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Sales rose in every region, and the </w:t></w:r><w:r><w:t>north</w:t></w:r><w:r><w:t> led it.</w:t></w:r></w:p>
    <w:p><w:ins w:id="1" w:author="A reviewer" w:date="2026-08-31T17:00:00Z"><w:r><w:t>A sentence somebody added with track changes on.</w:t></w:r></w:ins></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>A bulleted point</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>A numbered point</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="4675"/><w:gridCol w:w="4675"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>120</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>"#;

    let styles = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>"#;

    let numbering = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>"#;

    let types = format!(
        r#"{XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>"#
    );

    let package_rels = relationships(&[(
        "rId1",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        "word/document.xml",
    )]);
    let document_rels = relationships(&[
        (
            "rId1",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
            "styles.xml",
        ),
        (
            "rId2",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
            "numbering.xml",
        ),
    ]);

    // The last three are parts nothing here parses, and they are in the sample because what a save has to leave alone is exactly the half of a document this app never understood.
    written_archive(&[
        (CONTENT_TYPES, &types, false),
        ("_rels/.rels", &package_rels, false),
        ("word/document.xml", body, false),
        ("word/styles.xml", styles, false),
        ("word/numbering.xml", numbering, false),
        ("word/_rels/document.xml.rels", &document_rels, false),
        ("word/theme/theme1.xml", THEME, false),
        ("word/comments.xml", COMMENTS, false),
        ("word/charts/chart1.xml", CHART, false),
    ])
}

/// An Excel workbook whose text cells are all shared strings, the way Excel's own writer produces them — including one string two cells share, which is the case a save must not rewrite under the cell nobody typed in.
fn sample_xlsx() -> Vec<u8> {
    let sheet = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>120</v></c><c r="C2" t="s"><v>5</v></c></row>
    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>98</v></c><c r="C3" t="s"><v>5</v></c></row>
  </sheetData>
</worksheet>"#;

    // Six strings, and the last is the one A2 and A3's neighbors both point at.
    let shared = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uniqueCount="6">
  <si><t>Region</t></si>
  <si><t>Sales</t></si>
  <si><t>Status</t></si>
  <si><t>North</t></si>
  <si><t>South</t></si>
  <si><t>Open</t></si>
</sst>"#;

    let workbook = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Figures" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#;

    let styles = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="1"><xf xfId="0"/></cellXfs>
</styleSheet>"#;

    let types = format!(
        r#"{XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"#
    );

    let package_rels = relationships(&[(
        "rId1",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        "xl/workbook.xml",
    )]);
    let workbook_rels = relationships(&[
        (
            "rId1",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
            "worksheets/sheet1.xml",
        ),
        (
            "rId2",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
            "sharedStrings.xml",
        ),
        (
            "rId3",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
            "styles.xml",
        ),
    ]);

    written_archive(&[
        (CONTENT_TYPES, &types, false),
        ("_rels/.rels", &package_rels, false),
        ("xl/workbook.xml", workbook, false),
        ("xl/_rels/workbook.xml.rels", &workbook_rels, false),
        ("xl/worksheets/sheet1.xml", sheet, false),
        ("xl/sharedStrings.xml", shared, false),
        ("xl/styles.xml", styles, false),
    ])
}

/// A two-slide deck, each slide a title placeholder and a body, which is what the outline reads one entry per slide out of.
fn sample_pptx() -> Vec<u8> {
    let presentation = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"#;

    let presentation_rels = relationships(&[
        (
            "rId1",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
            "slideMasters/slideMaster1.xml",
        ),
        (
            "rId2",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
            "slides/slide1.xml",
        ),
        (
            "rId3",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
            "slides/slide2.xml",
        ),
    ]);

    let slide_rels = relationships(&[(
        "rId1",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
        "../slideLayouts/slideLayout1.xml",
    )]);

    let types = format!(
        r#"{XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>"#
    );

    let package_rels = relationships(&[(
        "rId1",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        "ppt/presentation.xml",
    )]);

    let master_rels = relationships(&[
        (
            "rId1",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
            "../slideLayouts/slideLayout1.xml",
        ),
        (
            "rId2",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
            "../theme/theme1.xml",
        ),
    ]);
    let layout_rels = relationships(&[(
        "rId1",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
        "../slideMasters/slideMaster1.xml",
    )]);

    written_archive(&[
        (CONTENT_TYPES, &types, false),
        ("_rels/.rels", &package_rels, false),
        ("ppt/presentation.xml", presentation, false),
        ("ppt/_rels/presentation.xml.rels", &presentation_rels, false),
        (
            "ppt/slides/slide1.xml",
            &slide_xml("What we shipped", "One slide is not a deck."),
            false,
        ),
        (
            "ppt/slides/slide2.xml",
            &slide_xml("What is next", "The second slide proves the order is kept."),
            false,
        ),
        ("ppt/slides/_rels/slide1.xml.rels", &slide_rels, false),
        ("ppt/slides/_rels/slide2.xml.rels", &slide_rels, false),
        ("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER, false),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            &master_rels,
            false,
        ),
        ("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT, false),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            &layout_rels,
            false,
        ),
        ("ppt/theme/theme1.xml", THEME, false),
    ])
}

fn slide_xml(title: &str, body: &str) -> String {
    format!(
        r#"{XML_HEAD}
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>{title}</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>{body}</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>
</p:sld>"#
    )
}

const SLIDE_MASTER: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>"#;

const SLIDE_LAYOUT: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj" preserve="1">
  <p:cSld name="Title and Content"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>"#;

/// The smallest theme PowerPoint accepts: one color scheme, one font scheme, one format scheme. A deck with no theme is a deck PowerPoint offers to repair.
const THEME: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>"#;

/// A comment nobody here reads, in a document the app draws without it.
const COMMENTS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="1" w:author="A reviewer" w:date="2026-08-31T17:00:00Z"><w:p><w:r><w:t>Is this the right number?</w:t></w:r></w:p></w:comment>
</w:comments>"#;

/// A chart, for the same reason: a save must not touch it.
const CHART: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart/></c:plotArea></c:chart></c:chartSpace>"#;

const XML_HEAD: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;

/// A relationship part, which every OOXML package needs at least two of.
fn relationships(rows: &[(&str, &str, &str)]) -> String {
    let mut out = format!(
        "{XML_HEAD}\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\n"
    );
    for (id, kind, target) in rows {
        out.push_str(&format!(
            "  <Relationship Id=\"{id}\" Type=\"{kind}\" Target=\"{target}\"/>\n"
        ));
    }
    out.push_str("</Relationships>");
    out
}

/// An OpenDocument text document: a heading, two paragraphs, a bulleted item and a numbered item.
fn sample_odt() -> Vec<u8> {
    let content = format!(
        r#"{XML_HEAD}
<office:document-content {ODF_NAMESPACES} office:version="1.3">
  <office:automatic-styles>
    <text:list-style style:name="Numbers"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style>
    <text:list-style style:name="Bullets"><text:list-level-style-bullet text:level="1" text:bullet-char="&#8226;"/></text:list-style>
  </office:automatic-styles>
  <office:body><office:text>
    <text:h text:outline-level="1">Quarterly report</text:h>
    <text:p>Sales rose in every region, and the north led it.</text:p>
    <text:list text:style-name="Bullets"><text:list-item><text:p>A bulleted point</text:p></text:list-item></text:list>
    <text:list text:style-name="Numbers"><text:list-item><text:p>A numbered point</text:p></text:list-item></text:list>
    <table:table table:name="Sales"><table:table-column table:number-columns-repeated="2"/>
      <table:table-row><table:table-cell office:value-type="string"><text:p>Region</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Sales</text:p></table:table-cell></table:table-row>
      <table:table-row><table:table-cell office:value-type="string"><text:p>North</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="120"><text:p>120</text:p></table:table-cell></table:table-row>
    </table:table>
  </office:text></office:body>
</office:document-content>"#
    );
    open_document("application/vnd.oasis.opendocument.text", &content, "text")
}

/// An OpenDocument spreadsheet, drawn as the record table an `.xlsx` is drawn as.
fn sample_ods() -> Vec<u8> {
    let content = format!(
        r#"{XML_HEAD}
<office:document-content {ODF_NAMESPACES} office:version="1.3">
  <office:body><office:spreadsheet>
    <table:table table:name="Figures"><table:table-column table:number-columns-repeated="3"/>
      <table:table-row><table:table-cell office:value-type="string"><text:p>Region</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Sales</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Status</text:p></table:table-cell></table:table-row>
      <table:table-row><table:table-cell office:value-type="string"><text:p>North</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="120"><text:p>120</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Open</text:p></table:table-cell></table:table-row>
      <table:table-row><table:table-cell office:value-type="string"><text:p>South</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="98"><text:p>98</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Open</text:p></table:table-cell></table:table-row>
    </table:table>
  </office:spreadsheet></office:body>
</office:document-content>"#
    );
    open_document(
        "application/vnd.oasis.opendocument.spreadsheet",
        &content,
        "spreadsheet",
    )
}

/// An OpenDocument presentation of two pages, read one entry per slide the way a `.pptx` is.
fn sample_odp() -> Vec<u8> {
    let content = format!(
        r#"{XML_HEAD}
<office:document-content {ODF_NAMESPACES} office:version="1.3">
  <office:body><office:presentation>
    <draw:page draw:name="What we shipped">
      <draw:frame><draw:text-box><text:p>One slide is not a deck.</text:p></draw:text-box></draw:frame>
    </draw:page>
    <draw:page draw:name="What is next">
      <draw:frame><draw:text-box><text:p>The second page proves the order is kept.</text:p></draw:text-box></draw:frame>
    </draw:page>
  </office:presentation></office:body>
</office:document-content>"#
    );
    open_document(
        "application/vnd.oasis.opendocument.presentation",
        &content,
        "presentation",
    )
}

const ODF_NAMESPACES: &str = concat!(
    r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" "#,
    r#"xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" "#,
    r#"xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" "#,
    r#"xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" "#,
    r#"xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0""#
);

/// An OpenDocument package. `mimetype` is written first and stored uncompressed, which is what puts its bytes at offset 38 where a format sniffer looks for them.
fn open_document(mime: &str, content: &str, body: &str) -> Vec<u8> {
    let styles = format!(
        r#"{XML_HEAD}
<office:document-styles {ODF_NAMESPACES} office:version="1.3"><office:styles/></office:document-styles>"#
    );
    let manifest = format!(
        r#"{XML_HEAD}
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="{mime}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>"#
    );
    // The body element is named in the mime type as well, so a sample that disagrees with itself fails here rather than in a reader.
    assert!(content.contains(&format!("<office:{body}>")));
    written_archive(&[
        ("mimetype", mime, true),
        ("content.xml", content, false),
        ("styles.xml", &styles, false),
        ("META-INF/manifest.xml", &manifest, false),
    ])
}
