//! What a file's bytes mean as text.
//!
//! An encoding belongs to the file, not to the text, so it is learned once when the file is read, carried on the open document, and spent again when the file is written. Saving never changes how a file is spelled.
//!
//! Everything here is `std`.
//!
//! A byte order mark is taken off the text and remembered rather than left in it. Left in it is a character at offset zero, so pulldown-cmark reads `\u{feff}- [ ] a` as a paragraph, `---` stops opening frontmatter, and `serde_json` refuses the document. [`encode_source`] puts it back.

use crate::*;

/// How many bytes of a file are searched for the zero byte that says "this is not text". Enough to catch a real binary's header without reading far.
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// How a file's bytes spell its text.
///
/// Every one of these is *declared* by the file, by its byte order mark. There is no variant for a legacy code page, because nothing in such a file says it is one: those are read as Windows-1252 and the text is UTF-8 from then on — see [`decode_source`] — so the app never writes a guess back out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SourceEncoding {
    #[default]
    Utf8,
    Utf16Le,
    Utf16Be,
    Utf32Le,
    Utf32Be,
}

/// How a file spells its text: which encoding, and whether it opens with a byte order mark. The two travel together because writing the file back needs both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SourceSpelling {
    pub encoding: SourceEncoding,
    /// Whether the file began with a mark. Kept as a fact about the file rather than as a character in the text — see the module comment.
    pub mark: bool,
}

impl SourceSpelling {
    /// Plain UTF-8, no mark: what a string that never came from a file is.
    pub fn utf8() -> Self {
        Self::default()
    }
}

/// A document's text together with how the file it came from spells it. The text never carries a leading mark; `spelling.mark` remembers it instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceText {
    pub text: String,
    pub spelling: SourceSpelling,
}

impl SourceText {
    /// UTF-8 text that came from somewhere other than a file read — the code view's unsaved buffer, a test fixture.
    pub fn utf8(text: String) -> Self {
        Self {
            text,
            spelling: SourceSpelling::utf8(),
        }
    }
}

/// Read a document, decoding it by the encoding its bytes declare.
///
/// Check order is load-bearing: four-byte marks before two-byte ones, or UTF-32 LE (`FF FE 00 00`) reads as UTF-16 LE and comes out as garbage rather than an error; and valid UTF-8 before the zero-byte test, since `U+0000` is legal UTF-8.
pub fn read_source(path: impl AsRef<Path>) -> io::Result<SourceText> {
    let path = path.as_ref();
    let bytes = fs::read(path)?;
    decode_source(&bytes).map_err(|message| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{} ({})", message, path.display()),
        )
    })
}

/// Read at most `limit` bytes of a document and decode those. For a caller that wants only what is at the top of a file — the frontmatter block — across a folder of them, where reading each one whole is the cost.
///
/// The cut lands wherever the limit falls, so bytes belonging to a character the cut split are dropped rather than decoded as something else.
pub fn read_source_head(path: impl AsRef<Path>, limit: usize) -> io::Result<SourceText> {
    use std::io::Read;
    let path = path.as_ref();
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit as u64)
        .read_to_end(&mut bytes)?;
    bytes.truncate(whole_characters(&bytes));
    decode_source(&bytes).map_err(|message| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{} ({})", message, path.display()),
        )
    })
}

/// How much of a part-read buffer is whole characters, by the encoding its mark declares. A split code unit, or a surrogate whose other half is past the cut, is not an error in the file — so it comes off rather than failing the read.
fn whole_characters(bytes: &[u8]) -> usize {
    match marked_encoding(bytes) {
        Some(SourceEncoding::Utf32Le | SourceEncoding::Utf32Be) => bytes.len() - bytes.len() % 4,
        Some(encoding) => {
            let mut len = bytes.len() - bytes.len() % 2;
            let leading = |pair: &[u8]| {
                let pair = [pair[0], pair[1]];
                let unit = if encoding == SourceEncoding::Utf16Be {
                    u16::from_be_bytes(pair)
                } else {
                    u16::from_le_bytes(pair)
                };
                (0xD800..0xDC00).contains(&unit)
            };
            if len >= 2 && leading(&bytes[len - 2..len]) {
                len -= 2;
            }
            len
        }
        // `error_len` tells a cut tail (`None`) from a byte no UTF-8 file could hold, which is a legacy code page and decodes whole further down.
        None => match std::str::from_utf8(bytes) {
            Ok(_) => bytes.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => bytes.len(),
        },
    }
}

/// Decode file bytes. Split from [`read_source`] so the decision table is testable without touching the disk.
pub fn decode_source(bytes: &[u8]) -> Result<SourceText, String> {
    // A wide mark decodes along with everything else and then comes off the front of the text, so no parser downstream ever meets one.
    if let Some(encoding) = marked_encoding(bytes) {
        let text = match encoding {
            SourceEncoding::Utf32Le => decode_utf32(bytes, false),
            SourceEncoding::Utf32Be => decode_utf32(bytes, true),
            SourceEncoding::Utf16Le => decode_utf16(bytes, false),
            SourceEncoding::Utf16Be => decode_utf16(bytes, true),
            _ => unreachable!("marked_encoding only reports the marked encodings"),
        }?;
        return Ok(SourceText {
            text: strip_mark(&text),
            spelling: SourceSpelling {
                encoding,
                mark: true,
            },
        });
    }

    match std::str::from_utf8(bytes) {
        Ok(text) => Ok(SourceText {
            text: strip_mark(text),
            spelling: SourceSpelling {
                encoding: SourceEncoding::Utf8,
                mark: text.starts_with(MARK),
            },
        }),
        Err(_) => match first_zero_byte(bytes) {
            Some(offset) => Err(format!(
                "This doesn't look like a text file — there's a zero byte at {offset}"
            )),
            // Some legacy code page, and nothing says which. Windows-1252 always decodes, so the file opens and mojibake is at least visible. The text is UTF-8 from here on: writing the guess back would drop any character it has no room for, and losing text beats re-spelling a file.
            None => Ok(SourceText {
                text: decode_windows_1252(bytes),
                spelling: SourceSpelling::utf8(),
            }),
        },
    }
}

/// Write `text` back the way the file was spelled when it was read. The one way a document reaches the disk, so a save can't quietly re-encode one.
pub fn write_source(
    path: impl AsRef<Path>,
    text: &str,
    spelling: SourceSpelling,
) -> io::Result<()> {
    fs::write(path, encode_source(text, spelling))
}

/// Encode `text` as `spelling` describes, putting back the mark the read took off. The wide encodings always get one: it is the only thing identifying them, so an unmarked UTF-16 file is one this app could not open again.
pub fn encode_source(text: &str, spelling: SourceSpelling) -> Vec<u8> {
    let marked = |wants_mark: bool| -> String {
        if wants_mark {
            format!("{MARK}{text}")
        } else {
            text.to_string()
        }
    };
    match spelling.encoding {
        SourceEncoding::Utf8 => marked(spelling.mark).into_bytes(),
        SourceEncoding::Utf16Le => encode_utf16(&marked(true), false),
        SourceEncoding::Utf16Be => encode_utf16(&marked(true), true),
        SourceEncoding::Utf32Le => encode_utf32(&marked(true), false),
        SourceEncoding::Utf32Be => encode_utf32(&marked(true), true),
    }
}

/// The byte order mark, as the character it decodes to.
const MARK: char = '\u{feff}';

/// `text` without a leading mark. Only the first one: a `U+FEFF` anywhere else is a zero-width no-break space the author put there, and not ours to remove.
fn strip_mark(text: &str) -> String {
    text.strip_prefix(MARK).unwrap_or(text).to_string()
}

/// The encoding a leading byte order mark declares, if there is one. Four-byte marks are tested first: `FF FE 00 00` is UTF-32 LE, and its first two bytes are also the UTF-16 LE mark.
fn marked_encoding(bytes: &[u8]) -> Option<SourceEncoding> {
    if bytes.starts_with(&[0xFF, 0xFE, 0x00, 0x00]) {
        return Some(SourceEncoding::Utf32Le);
    }
    if bytes.starts_with(&[0x00, 0x00, 0xFE, 0xFF]) {
        return Some(SourceEncoding::Utf32Be);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some(SourceEncoding::Utf16Le);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some(SourceEncoding::Utf16Be);
    }
    None
}

/// Offset of the first zero byte in the sniffed prefix — git's test for a file that is not text.
fn first_zero_byte(bytes: &[u8]) -> Option<usize> {
    bytes
        .iter()
        .take(BINARY_SNIFF_BYTES)
        .position(|byte| *byte == 0)
}

fn decode_utf16(bytes: &[u8], big_endian: bool) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err(format!(
            "This file claims to be UTF-16 but has {} bytes, which can't divide into pairs",
            bytes.len()
        ));
    }
    let units = bytes.chunks_exact(2).map(|pair| {
        let pair = [pair[0], pair[1]];
        if big_endian {
            u16::from_be_bytes(pair)
        } else {
            u16::from_le_bytes(pair)
        }
    });
    char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .map_err(|error| {
            format!(
                "This file claims to be UTF-16 but holds an unpaired surrogate ({:04X})",
                error.unpaired_surrogate()
            )
        })
}

fn decode_utf32(bytes: &[u8], big_endian: bool) -> Result<String, String> {
    if bytes.len() % 4 != 0 {
        return Err(format!(
            "This file claims to be UTF-32 but has {} bytes, which can't divide into fours",
            bytes.len()
        ));
    }
    bytes
        .chunks_exact(4)
        .map(|quad| {
            let quad = [quad[0], quad[1], quad[2], quad[3]];
            let value = if big_endian {
                u32::from_be_bytes(quad)
            } else {
                u32::from_le_bytes(quad)
            };
            // `from_u32` already refuses surrogates and anything past 10FFFF, which is the whole of UTF-32's validity rule.
            char::from_u32(value).ok_or_else(|| {
                format!(
                    "This file claims to be UTF-32 but holds {value:#X}, which is not a character"
                )
            })
        })
        .collect()
}

fn encode_utf16(text: &str, big_endian: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() * 2);
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&if big_endian {
            unit.to_be_bytes()
        } else {
            unit.to_le_bytes()
        });
    }
    bytes
}

fn encode_utf32(text: &str, big_endian: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() * 4);
    for ch in text.chars() {
        let value = ch as u32;
        bytes.extend_from_slice(&if big_endian {
            value.to_be_bytes()
        } else {
            value.to_le_bytes()
        });
    }
    bytes
}

/// Decode as Windows-1252, which cannot fail: ASCII below `80`, Latin-1 from `A0`, and the table below between. The five bytes Windows leaves undefined map to their C1 controls, as WHATWG specifies, so all 256 values have an answer.
fn decode_windows_1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| match byte {
            0x80..=0x9F => WINDOWS_1252_HIGH[(*byte - 0x80) as usize],
            other => char::from(*other),
        })
        .collect()
}

/// The `80`–`9F` block, where Windows-1252 differs from Latin-1.
const WINDOWS_1252_HIGH: [char; 32] = [
    '\u{20AC}', '\u{0081}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{008D}', '\u{017D}', '\u{008F}',
    '\u{0090}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{009D}', '\u{017E}', '\u{0178}',
];
