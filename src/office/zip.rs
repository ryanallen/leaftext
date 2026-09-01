//! The archive a Word, Excel, PowerPoint or OpenDocument file really is: a zip of XML members, read and written here rather than by a crate.
//!
//! **Reading is the central directory, never a scan for local headers.** The directory is the only place a member's sizes are always true: two of the three real `.docx` this was built against write their sizes in a trailing data descriptor and leave the local header saying zero, so a reader that trusted the local header would inflate nothing out of them. The local header is opened for one thing only — its own name and extra lengths, which say where the member's data starts.
//!
//! **Three shapes break a naive reader and all three are handled.** A member may be stored rather than deflated (both real `.pptx` store every one of theirs), an archive may carry directory entries with no data at all (nineteen each in those same files), and a member may carry that trailing data descriptor.
//!
//! **Writing clears the descriptor rather than copying it.** Anything written here puts the true sizes in the local header and clears general-purpose flag bit 3, because a copy that keeps the flag while dropping the descriptor splits readers: a lenient one reads the file happily and the package layer Office itself is built on refuses the whole thing as corrupt.
//!
//! Nothing here touches a disk or a host. It takes bytes and answers bytes, so it compiles for the browser build unchanged.

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::fmt;
use std::io::{Read, Write};

const END_OF_CENTRAL_DIRECTORY: u32 = 0x0605_4b50;
const CENTRAL_FILE_HEADER: u32 = 0x0201_4b50;
const LOCAL_FILE_HEADER: u32 = 0x0403_4b50;

/// A member's bytes are stored as they are.
const METHOD_STORED: u16 = 0;
/// A member's bytes are deflated.
const METHOD_DEFLATED: u16 = 8;

/// General-purpose flag bit 3: the sizes are in a trailing data descriptor rather than in the local header. Nothing the reader does asks it — the sizes come from the directory — so only the check that a written archive cleared it reads this.
#[cfg(test)]
const FLAG_DATA_DESCRIPTOR: u16 = 1 << 3;

/// A zip's end-of-directory record is 22 bytes plus a comment nobody writes, and the comment may be up to 64 KB.
const END_RECORD_MIN: usize = 22;

/// Why an archive could not be read, phrased for someone looking at the file rather than at the specification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArchiveError(String);

impl fmt::Display for ArchiveError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

fn refuse(message: impl Into<String>) -> ArchiveError {
    ArchiveError(message.into())
}

/// A reader's own refusal, said in the same words a damaged archive is refused in — the page shows one sentence either way, and where it came from is not the reader's business.
impl From<String> for ArchiveError {
    fn from(message: String) -> Self {
        Self(message)
    }
}

/// One member of an archive, as the central directory describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Member {
    name: String,
    method: u16,
    compressed_size: usize,
    uncompressed_size: usize,
    local_header_at: usize,
    /// The member's checksum, kept so a member copied into a rewritten archive keeps the one it arrived with.
    crc: u32,
}

/// An archive read out of bytes it borrows. Members are listed in the order the directory writes them, which for an OpenDocument file is the order `mimetype` has to keep.
#[derive(Debug, Clone)]
pub(crate) struct Archive<'a> {
    bytes: &'a [u8],
    members: Vec<Member>,
}

impl<'a> Archive<'a> {
    /// Read an archive's directory. The members' own bytes are left where they are and inflated only when one is asked for, which is why opening a 127-member presentation costs microseconds.
    pub(crate) fn read(bytes: &'a [u8]) -> Result<Self, ArchiveError> {
        let end = end_record_at(bytes).ok_or_else(|| {
            refuse("This isn't an archive — it has no zip directory at the end of it")
        })?;
        let count = u16_at(bytes, end + 10)? as usize;
        let directory_at = u32_at(bytes, end + 16)? as usize;
        let mut members = Vec::with_capacity(count);
        let mut at = directory_at;
        for _ in 0..count {
            if u32_at(bytes, at)? != CENTRAL_FILE_HEADER {
                return Err(refuse("This archive's directory is damaged"));
            }
            let name_length = u16_at(bytes, at + 28)? as usize;
            let extra_length = u16_at(bytes, at + 30)? as usize;
            let comment_length = u16_at(bytes, at + 32)? as usize;
            let name = std::str::from_utf8(slice(bytes, at + 46, name_length)?)
                .map_err(|_| refuse("This archive names a file in something that isn't text"))?
                .to_string();
            let member = Member {
                method: u16_at(bytes, at + 10)?,
                crc: u32_at(bytes, at + 16)?,
                compressed_size: u32_at(bytes, at + 20)? as usize,
                uncompressed_size: u32_at(bytes, at + 24)? as usize,
                local_header_at: u32_at(bytes, at + 42)? as usize,
                name,
            };
            // A directory entry names a folder and carries nothing; both real presentations built against carry nineteen of them.
            if !member.name.ends_with('/') {
                members.push(member);
            }
            at += 46 + name_length + extra_length + comment_length;
        }
        Ok(Self { bytes, members })
    }

    /// Every member's name, in directory order.
    #[cfg(test)]
    pub(crate) fn names(&self) -> impl Iterator<Item = &str> {
        self.members.iter().map(|member| member.name.as_str())
    }

    /// One member's bytes, inflated where it was deflated. `None` where the archive holds no such member, which is how a reader says a document is missing the part it is named for.
    pub(crate) fn member(&self, name: &str) -> Option<Result<Vec<u8>, ArchiveError>> {
        let member = self.members.iter().find(|member| member.name == name)?;
        Some(self.read_member(member))
    }

    /// One member as text. Every part of an Office or OpenDocument package this app reads is UTF-8 XML, so anything else is refused rather than guessed at.
    pub(crate) fn member_text(&self, name: &str) -> Option<Result<String, ArchiveError>> {
        Some(self.member(name)?.and_then(|bytes| {
            String::from_utf8(bytes).map_err(|_| {
                refuse(format!(
                    "{name} inside this file isn't text this app can read"
                ))
            })
        }))
    }

    fn read_member(&self, member: &Member) -> Result<Vec<u8>, ArchiveError> {
        let at = self.data_at(member)?;
        let packed = slice(self.bytes, at, member.compressed_size)?;
        match member.method {
            METHOD_STORED => Ok(packed.to_vec()),
            METHOD_DEFLATED => {
                let mut out = Vec::with_capacity(member.uncompressed_size);
                DeflateDecoder::new(packed)
                    .read_to_end(&mut out)
                    .map_err(|_| refuse(format!("{} inside this file is damaged", member.name)))?;
                Ok(out)
            }
            other => Err(refuse(format!(
                "{} inside this file is packed a way this app doesn't read (method {other})",
                member.name
            ))),
        }
    }

    /// Where a member's data begins: past its own local header, whose name and extra lengths are the only fields there worth trusting.
    fn data_at(&self, member: &Member) -> Result<usize, ArchiveError> {
        let at = member.local_header_at;
        if u32_at(self.bytes, at)? != LOCAL_FILE_HEADER {
            return Err(refuse(format!(
                "{} inside this file is not where the directory says it is",
                member.name
            )));
        }
        let name_length = u16_at(self.bytes, at + 26)? as usize;
        let extra_length = u16_at(self.bytes, at + 28)? as usize;
        Ok(at + 30 + name_length + extra_length)
    }

    /// The whole archive again with one member's contents replaced, every other member copied byte for byte out of what was read.
    ///
    /// Copied means the packed bytes travel as they are, with no inflate and no re-deflate, so a chart, a theme, a tracked change and a macro come back out of the new file exactly as they went into the old one. What changes on every member is its local header, rewritten with the true sizes and without the data-descriptor flag.
    pub(crate) fn with_member_replaced(
        &self,
        name: &str,
        contents: &[u8],
    ) -> Result<Vec<u8>, ArchiveError> {
        if !self.members.iter().any(|member| member.name == name) {
            return Err(refuse(format!("this file holds no {name} to write back")));
        }
        let mut writing = Vec::with_capacity(self.members.len());
        for member in &self.members {
            if member.name == name {
                // The replacement is packed the way the member it replaces was, so a stored `mimetype` stays stored.
                writing.push(WritingMember::new(
                    member.name.clone(),
                    contents.to_vec(),
                    member.method == METHOD_STORED,
                ));
            } else {
                writing.push(WritingMember {
                    name: member.name.clone(),
                    packed: slice(self.bytes, self.data_at(member)?, member.compressed_size)?
                        .to_vec(),
                    method: member.method,
                    crc: member.crc,
                    uncompressed_size: member.uncompressed_size,
                });
            }
        }
        Ok(write_archive(&writing))
    }
}

/// One member on its way into a new archive, already packed.
#[derive(Debug, Clone)]
pub(crate) struct WritingMember {
    name: String,
    packed: Vec<u8>,
    method: u16,
    crc: u32,
    uncompressed_size: usize,
}

impl WritingMember {
    /// A member built from its contents. `stored` keeps the bytes as they are, which is what an OpenDocument file's `mimetype` needs.
    pub(crate) fn new(name: String, contents: Vec<u8>, stored: bool) -> Self {
        let mut crc = flate2::Crc::new();
        crc.update(&contents);
        let uncompressed_size = contents.len();
        let (method, packed) = if stored {
            (METHOD_STORED, contents)
        } else {
            let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
            // Deflating memory into memory cannot fail; a member that somehow refuses is stored rather than lost.
            match encoder.write_all(&contents).and_then(|()| encoder.finish()) {
                Ok(packed) => (METHOD_DEFLATED, packed),
                Err(_) => (METHOD_STORED, contents),
            }
        };
        Self {
            name,
            packed,
            method,
            crc: crc.sum(),
            uncompressed_size,
        }
    }
}

/// Write an archive out of members already packed. Member order is kept exactly as given, which is what lets an OpenDocument file's `mimetype` stay the first member at byte 38 where a format sniffer looks for it.
pub(crate) fn write_archive(members: &[WritingMember]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut offsets = Vec::with_capacity(members.len());
    for member in members {
        offsets.push(out.len());
        out.extend_from_slice(&LOCAL_FILE_HEADER.to_le_bytes());
        // Version 2.0 needed, because deflate is.
        out.extend_from_slice(&20u16.to_le_bytes());
        // No flags at all: the sizes below are true, so nothing follows the data.
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&member.method.to_le_bytes());
        // A zip carries an MS-DOS timestamp, and every member here is written the same zero so a document built twice out of the same words is the same file.
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&member.crc.to_le_bytes());
        out.extend_from_slice(&(member.packed.len() as u32).to_le_bytes());
        out.extend_from_slice(&(member.uncompressed_size as u32).to_le_bytes());
        out.extend_from_slice(&(member.name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(member.name.as_bytes());
        out.extend_from_slice(&member.packed);
    }
    let directory_at = out.len();
    for (member, at) in members.iter().zip(&offsets) {
        out.extend_from_slice(&CENTRAL_FILE_HEADER.to_le_bytes());
        // Made by version 2.0, needing version 2.0.
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&member.method.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&member.crc.to_le_bytes());
        out.extend_from_slice(&(member.packed.len() as u32).to_le_bytes());
        out.extend_from_slice(&(member.uncompressed_size as u32).to_le_bytes());
        out.extend_from_slice(&(member.name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&(*at as u32).to_le_bytes());
        out.extend_from_slice(member.name.as_bytes());
    }
    let directory_size = out.len() - directory_at;
    out.extend_from_slice(&END_OF_CENTRAL_DIRECTORY.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&(members.len() as u16).to_le_bytes());
    out.extend_from_slice(&(members.len() as u16).to_le_bytes());
    out.extend_from_slice(&(directory_size as u32).to_le_bytes());
    out.extend_from_slice(&(directory_at as u32).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

/// Where the end-of-directory record starts, found by walking back from the end. A zip is read backwards because its directory is written last, and the record may sit up to a comment's length above the final byte.
fn end_record_at(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < END_RECORD_MIN {
        return None;
    }
    let earliest = bytes
        .len()
        .saturating_sub(END_RECORD_MIN + u16::MAX as usize);
    (earliest..=bytes.len() - END_RECORD_MIN)
        .rev()
        .find(|at| bytes[*at..*at + 4] == END_OF_CENTRAL_DIRECTORY.to_le_bytes())
}

fn slice(bytes: &[u8], at: usize, length: usize) -> Result<&[u8], ArchiveError> {
    bytes
        .get(at..at.saturating_add(length))
        .ok_or_else(|| refuse("This archive stops in the middle of itself"))
}

fn u16_at(bytes: &[u8], at: usize) -> Result<u16, ArchiveError> {
    Ok(u16::from_le_bytes(
        slice(bytes, at, 2)?.try_into().expect("two bytes"),
    ))
}

fn u32_at(bytes: &[u8], at: usize) -> Result<u32, ArchiveError> {
    Ok(u32::from_le_bytes(
        slice(bytes, at, 4)?.try_into().expect("four bytes"),
    ))
}

/// Whether the member at this local header claims its sizes follow the data rather than sitting in front of it. The reader never asks — it takes its sizes from the directory — so this is what a test reads to prove a written archive really did clear the flag.
#[cfg(test)]
pub(crate) fn local_header_defers_its_sizes(bytes: &[u8], at: usize) -> bool {
    u16_at(bytes, at + 6).is_ok_and(|flags| flags & FLAG_DATA_DESCRIPTOR != 0)
}
