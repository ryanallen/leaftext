//! Text encoding: what the bytes on disk mean, and that saving gives them back.
//!
//! The test that matters most here is the round-trip. Everything else in the app works on decoded text, so a mistake in this module is invisible until someone saves — at which point their file has been rewritten in an encoding they never chose. Each round-trip case below asserts the bytes, not the characters.

use super::*;

/// A per-test suffix so the temp directories here can't collide.
fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos()
}

/// Bytes for `text` in UTF-16, mark included, so a fixture reads as the thing it is testing rather than a wall of escapes.
fn utf16_bytes(text: &str, big_endian: bool) -> Vec<u8> {
    let mut bytes = Vec::new();
    for unit in format!("\u{feff}{text}").encode_utf16() {
        bytes.extend_from_slice(&if big_endian {
            unit.to_be_bytes()
        } else {
            unit.to_le_bytes()
        });
    }
    bytes
}

/// Bytes for `text` in UTF-32, mark included.
fn utf32_bytes(text: &str, big_endian: bool) -> Vec<u8> {
    let mut bytes = Vec::new();
    for ch in format!("\u{feff}{text}").chars() {
        let value = ch as u32;
        bytes.extend_from_slice(&if big_endian {
            value.to_be_bytes()
        } else {
            value.to_le_bytes()
        });
    }
    bytes
}

/// A sample with something above ASCII and something outside the basic plane, so UTF-16's surrogate pairing and UTF-32's four-byte code points both get used.
const SAMPLE: &str = "# Café 🌿\n\nBody text.\n";

#[test]
fn plain_utf8_and_ascii_are_read_as_utf8() {
    let ascii = decode_source(b"# Title\n").expect("ASCII is valid UTF-8");
    assert_eq!(ascii.spelling.encoding, SourceEncoding::Utf8);
    assert!(!ascii.spelling.mark);
    assert_eq!(ascii.text, "# Title\n");

    // ASCII is not a separate case: every ASCII file is already a UTF-8 file, so there is nothing to detect and nothing to convert.
    let utf8 = decode_source(SAMPLE.as_bytes()).expect("UTF-8 sample decodes");
    assert_eq!(utf8.spelling.encoding, SourceEncoding::Utf8);
    assert_eq!(utf8.text, SAMPLE);
}

#[test]
fn a_mark_comes_off_the_text_and_goes_back_on_the_file() {
    let marked = format!("\u{feff}{SAMPLE}");
    let read = decode_source(marked.as_bytes()).expect("a marked UTF-8 file decodes");

    assert_eq!(read.spelling.encoding, SourceEncoding::Utf8);
    assert!(read.spelling.mark, "the mark is remembered as a fact");
    assert_eq!(
        read.text, SAMPLE,
        "and taken off the text, so no parser downstream has to know about it"
    );
    assert_eq!(
        encode_source(&read.text, read.spelling),
        marked.as_bytes(),
        "the save puts it back: the file is unchanged"
    );
}

#[test]
fn an_unmarked_file_does_not_gain_a_mark_on_save() {
    let read = decode_source(SAMPLE.as_bytes()).expect("plain UTF-8 decodes");
    assert!(!read.spelling.mark);
    assert_eq!(
        encode_source(&read.text, read.spelling),
        SAMPLE.as_bytes(),
        "adding a mark would be as much of a change as removing one"
    );
}

#[test]
fn a_zero_width_space_inside_the_text_is_the_authors_and_stays() {
    // Only a *leading* mark is the file's own. The same character later in the document is a zero-width no-break space someone typed.
    let text = "a\u{feff}b";
    let read = decode_source(text.as_bytes()).expect("decodes");
    assert!(!read.spelling.mark);
    assert_eq!(read.text, text);
}

#[test]
fn utf16_and_utf32_documents_round_trip_to_the_same_bytes() {
    for (label, bytes, expected) in [
        (
            "UTF-16 LE",
            utf16_bytes(SAMPLE, false),
            SourceEncoding::Utf16Le,
        ),
        (
            "UTF-16 BE",
            utf16_bytes(SAMPLE, true),
            SourceEncoding::Utf16Be,
        ),
        (
            "UTF-32 LE",
            utf32_bytes(SAMPLE, false),
            SourceEncoding::Utf32Le,
        ),
        (
            "UTF-32 BE",
            utf32_bytes(SAMPLE, true),
            SourceEncoding::Utf32Be,
        ),
    ] {
        let read = decode_source(&bytes).unwrap_or_else(|error| panic!("{label}: {error}"));
        assert_eq!(
            read.spelling.encoding, expected,
            "{label} is detected by its mark"
        );
        assert_eq!(
            read.text, SAMPLE,
            "{label} decodes to the text, mark removed"
        );
        assert_eq!(
            encode_source(&read.text, read.spelling),
            bytes,
            "{label} must write back byte for byte — anything else silently \
             re-encodes someone's file"
        );
    }
}

#[test]
fn a_wide_file_is_written_with_a_mark_even_if_something_dropped_it() {
    // An unmarked UTF-16 file is one this app could never open again, since the mark is the only thing that identifies it. So the mark is not optional here the way it is for UTF-8.
    let spelling = SourceSpelling {
        encoding: SourceEncoding::Utf16Le,
        mark: false,
    };
    assert_eq!(encode_source("hi", spelling), utf16_bytes("hi", false));
}

#[test]
fn a_utf32_le_file_is_not_mistaken_for_utf16() {
    // `FF FE 00 00` opens a UTF-32 LE file, and its first two bytes are the UTF-16 LE mark. Read as UTF-16 it does not fail — it succeeds and produces garbage, which then gets saved. So the four-byte marks must be tested first, and this test is what holds that order in place.
    let bytes = utf32_bytes("hi", false);
    assert_eq!(&bytes[..4], &[0xFF, 0xFE, 0x00, 0x00]);

    let read = decode_source(&bytes).expect("UTF-32 LE decodes");
    assert_eq!(read.spelling.encoding, SourceEncoding::Utf32Le);
    assert_eq!(read.text, "hi");
}

#[test]
fn a_utf32_be_file_is_not_mistaken_for_a_binary() {
    // `00 00 FE FF` starts with the two zero bytes that otherwise mean "not text", so the mark has to be read before the binary test runs.
    let bytes = utf32_bytes("hi", true);
    assert_eq!(&bytes[..4], &[0x00, 0x00, 0xFE, 0xFF]);

    let read = decode_source(&bytes).expect("UTF-32 BE decodes");
    assert_eq!(read.spelling.encoding, SourceEncoding::Utf32Be);
    assert_eq!(read.text, "hi");
}

#[test]
fn a_truncated_wide_file_is_refused_rather_than_half_read() {
    let mut utf16 = utf16_bytes("hi", false);
    utf16.pop();
    let error = decode_source(&utf16).expect_err("an odd byte count can't be UTF-16");
    assert!(
        error.contains("pairs"),
        "the message should say why, got: {error}"
    );

    let mut utf32 = utf32_bytes("hi", false);
    utf32.pop();
    let error = decode_source(&utf32).expect_err("a stray byte count can't be UTF-32");
    assert!(
        error.contains("fours"),
        "the message should say why, got: {error}"
    );
}

#[test]
fn an_unpaired_surrogate_is_refused_because_it_cannot_be_written_back() {
    // A lone high surrogate: valid UTF-16 code units, not valid text. Replacing it with U+FFFD would open the file and then corrupt it on save, so the read fails instead.
    let bytes = [0xFF, 0xFE, 0x00, 0xD8, 0x69, 0x00];
    let error = decode_source(&bytes).expect_err("an unpaired surrogate is not text");
    assert!(
        error.contains("surrogate"),
        "the message should name the problem, got: {error}"
    );
}

#[test]
fn legacy_bytes_open_and_the_text_becomes_utf8() {
    // `Caf\xE9` — Windows-1252, the encoding a Notepad from 2003 wrote. Not valid UTF-8, and no mark to say what it is. It opens anyway, because Windows-1252 always decodes and mojibake is something a person can see and judge.
    let read = decode_source(b"# Caf\xE9 notes\n").expect("Windows-1252 always decodes");
    assert_eq!(read.text, "# Café notes\n");

    // From here the text is UTF-8, so saving converts the file. That is the deliberate trade: writing the guess back out would drop any character it has no room for — an emoji typed into it — and losing text is worse than changing how a file is spelled.
    assert_eq!(read.spelling.encoding, SourceEncoding::Utf8);
    assert!(!read.spelling.mark, "and no mark is invented");
    assert_eq!(
        encode_source(&read.text, read.spelling),
        "# Café notes\n".as_bytes()
    );
}

#[test]
fn every_byte_decodes_as_windows_1252_including_the_undefined_ones() {
    // The point of choosing Windows-1252 as the fallback: it cannot fail, so "this file won't open" stops being a possible answer for text. (Byte zero is excluded because a zero byte is how a binary is recognized, tested below.)
    let all: Vec<u8> = (1u8..=255).collect();
    let read = decode_source(&all).expect("all 255 non-zero byte values decode");
    assert_eq!(read.text.chars().count(), 255);

    // The five slots Windows leaves undefined map to their C1 controls rather than failing or dropping out.
    for byte in [0x81u8, 0x8D, 0x8F, 0x90, 0x9D] {
        let read = decode_source(&[byte]).expect("an undefined slot still decodes");
        assert_eq!(read.text.chars().next(), char::from_u32(byte as u32));
    }

    // And the slots that do differ from Latin-1 use the Windows meanings.
    assert_eq!(decode_source(b"\x93hi\x94").expect("quotes").text, "“hi”");
    assert_eq!(decode_source(b"\x80").expect("euro").text, "€");
}

#[test]
fn a_binary_is_refused_and_the_message_says_where() {
    let mut bytes = b"II*\x00\x08".to_vec();
    bytes.extend_from_slice(&[0xFF; 32]);
    let error = decode_source(&bytes).expect_err("a zero byte means this is not text");
    assert!(
        error.contains("zero byte at 3"),
        "the message should name the offset instead of just failing, got: {error}"
    );
}

#[test]
fn a_zero_byte_in_valid_utf8_still_opens() {
    // U+0000 is legal UTF-8, and such files open: the binary test runs only after UTF-8 has been ruled out.
    let read = decode_source(b"a\x00b").expect("a NUL inside valid UTF-8 is not a binary");
    assert_eq!(read.spelling.encoding, SourceEncoding::Utf8);
    assert_eq!(read.text, "a\u{0}b");
}

#[test]
fn reading_a_file_reports_the_path_when_it_cannot_be_decoded() {
    let dir = std::env::temp_dir().join(format!("leaf-encoding-{}", unique_suffix()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let path = dir.join("photo.md");
    fs::write(&path, b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR").expect("fixture is written");

    let error = read_source(&path).expect_err("a PNG is not a document");
    let message = error.to_string();
    assert!(
        message.contains("zero byte") && message.contains("photo.md"),
        "the error should say what and which file, got: {message}"
    );

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_head_read_cuts_between_characters_in_every_encoding() {
    let dir = std::env::temp_dir().join(format!("leaf-encoding-head-{}", unique_suffix()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    // Long enough that every cut below lands inside the body, and made of characters no cut can divide cleanly: 4 bytes in UTF-8, a surrogate pair in UTF-16, 4 bytes in UTF-32.
    let text = format!("# Head\n\n{}\n", "🌿".repeat(64));

    let utf8 = dir.join("utf8.md");
    fs::write(&utf8, text.as_bytes()).expect("fixture is written");
    let wide = dir.join("utf16.md");
    fs::write(&wide, utf16_bytes(&text, false)).expect("fixture is written");
    let widest = dir.join("utf32.md");
    fs::write(&widest, utf32_bytes(&text, true)).expect("fixture is written");

    // Every limit through a whole character's width, so each one lands mid-character in at least one of the three. A cut is not an error in the file: the split bytes come off and what is left is text.
    for limit in 30..40 {
        for path in [&utf8, &wide, &widest] {
            let head = read_source_head(path, limit).expect("a cut file still reads");
            assert!(
                text.starts_with(&head.text),
                "{}: {limit} bytes gave {:?}",
                path.display(),
                head.text
            );
        }
    }

    // Past the end is the whole file, and the encoding is still the file's own.
    let whole = read_source_head(&wide, 1 << 20).expect("read");
    assert_eq!(whole.text, text);
    assert_eq!(whole.spelling.encoding, SourceEncoding::Utf16Le);

    // A legacy code page has bytes no UTF-8 file could hold, which is not a cut — it decodes as Windows-1252 the same way a whole read does.
    let legacy = dir.join("legacy.md");
    fs::write(&legacy, b"# Caf\xe9 words\n").expect("fixture is written");
    assert_eq!(read_source_head(&legacy, 8).expect("read").text, "# Café w");

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_document_read_in_utf16_saves_back_as_utf16() {
    // The whole point, end to end: open a UTF-16 file, edit it through the buffer the app actually edits with, write it, and assert the file is still UTF-16.
    //
    // The checkbox is on the first line deliberately. With the mark left in the text, pulldown-cmark reads `\u{feff}- [ ] one` as a paragraph and there is no task marker to flip at all — so this fixture is also the test that the mark comes off.
    let dir = std::env::temp_dir().join(format!("leaf-encoding-save-{}", unique_suffix()));
    fs::create_dir_all(&dir).expect("fixture directory is created");
    let path = dir.join("notes.md");
    fs::write(&path, utf16_bytes("- [ ] one\n", false)).expect("fixture is written");

    let source = read_source(&path).expect("the fixture decodes");
    let mut edit = EditableDocument::new(path.clone(), source);
    assert_eq!(edit.spelling.encoding, SourceEncoding::Utf16Le);
    assert!(edit.toggle_task(0), "the checkbox flips");

    write_source(&path, edit.text(), edit.spelling).expect("the save succeeds");
    assert_eq!(
        fs::read(&path).expect("the saved file is readable"),
        utf16_bytes("- [x] one\n", false),
        "the flip is the only change; the file is still UTF-16 LE with its mark"
    );

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_marked_utf8_document_can_edit_its_first_line() {
    // The same rule for a UTF-8 file with a mark whose first line is a list.
    let source = decode_source("- [ ] one\n".as_bytes().to_vec().as_slice())
        .expect("unmarked control decodes");
    let marked = decode_source(format!("\u{feff}- [ ] one\n").as_bytes()).expect("marked decodes");
    assert_eq!(source.text, marked.text, "only the mark differs");

    let mut edit = EditableDocument::new(PathBuf::from("todo.md"), marked);
    assert!(
        edit.toggle_task(0),
        "a mark used to turn the first line into a paragraph, so there was no \
         checkbox to flip"
    );
    assert_eq!(edit.text(), "- [x] one\n");
    assert!(
        edit.spelling.mark,
        "and the mark is still on its way back to the file"
    );
}

#[test]
fn documents_that_used_to_fail_to_open_now_open() {
    // `read_to_string` is UTF-8-or-fail and neither of these files is UTF-8, so both have to reach the reader through the decoder.
    let dir = std::env::temp_dir().join(format!("leaf-encoding-open-{}", unique_suffix()));
    fs::create_dir_all(&dir).expect("fixture directory is created");

    let wide = dir.join("wide.md");
    fs::write(&wide, utf16_bytes("# Wide\n", false)).expect("fixture is written");
    assert_contains(
        &load_document(&wide).expect("a UTF-16 document opens").html,
        "Wide",
    );

    let legacy = dir.join("legacy.md");
    fs::write(&legacy, b"# Caf\xE9\n").expect("fixture is written");
    assert_contains(
        &load_document(&legacy)
            .expect("a legacy document still opens")
            .html,
        "Café",
    );

    fs::remove_dir_all(&dir).ok();
}
