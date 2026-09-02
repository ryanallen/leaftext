//! The stands the suite reads and builds a package through, so `src/tests/office.rs` never has to reach past this module's door.
//!
//! **The two hand-rolled archives here are the shapes this tree's own writer never writes.** A trailing data descriptor and a folder entry with no data both turn up in real Office files — two of three real Word documents carry the first, and both real presentations carry nineteen of the second — and neither can be produced by [`super::zip::write_archive`], which puts true sizes in front of every member and writes no folders at all. So they are built here by hand, against the specification rather than against our own writer, which is the only way the reader is proved on something it did not make.

use super::*;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::io::Write;
use zip::WritingMember;

const LOCAL_FILE_HEADER: u32 = 0x0403_4b50;
const CENTRAL_FILE_HEADER: u32 = 0x0201_4b50;
const END_OF_CENTRAL_DIRECTORY: u32 = 0x0605_4b50;
const DATA_DESCRIPTOR: u32 = 0x0807_4b50;
const METHOD_STORED: u16 = 0;
const METHOD_DEFLATED: u16 = 8;

/// The most one member may weigh unpacked, so a test can stand a member exactly on the ceiling rather than writing the number out a second time and drifting from it.
pub(crate) const MAX_MEMBER_BYTES: usize = zip::MAX_MEMBER_BYTES;

/// An archive of members given as text, each stored or deflated as asked. The ordinary way a sample document is built.
pub(crate) fn written_archive(members: &[(&str, &str, bool)]) -> Vec<u8> {
    let packed: Vec<(&str, &[u8], bool)> = members
        .iter()
        .map(|(name, contents, stored)| (*name, contents.as_bytes(), *stored))
        .collect();
    written_archive_bytes(&packed)
}

/// The same, over members that are not text — a macro, a picture, a font — because what a save has to survive is every member, not only the ones this app can read.
pub(crate) fn written_archive_bytes(members: &[(&str, &[u8], bool)]) -> Vec<u8> {
    let packed: Vec<WritingMember> = members
        .iter()
        .map(|(name, contents, stored)| {
            WritingMember::new(name.to_string(), contents.to_vec(), *stored)
        })
        .collect();
    zip::write_archive(&packed)
}

/// One member's bytes, whatever they are.
pub(crate) fn member_bytes(bytes: &[u8], name: &str) -> Option<Vec<u8>> {
    archive(bytes).member(name)?.ok()
}

/// The archive read out of bytes, for a test that wants to ask it something directly.
pub(crate) fn archive(bytes: &[u8]) -> Archive<'_> {
    Archive::read(bytes).expect("these bytes are an archive")
}

/// One member's text, or `None` where the archive holds no such member.
pub(crate) fn read_archive_member(bytes: &[u8], name: &str) -> Option<String> {
    archive(bytes).member_text(name)?.ok()
}

/// Every member the reader found, in directory order. A folder entry is not a member, so it never appears here.
pub(crate) fn member_names(bytes: &[u8]) -> Vec<String> {
    archive(bytes).names().map(str::to_string).collect()
}

/// Whether any member of this archive claims its sizes follow its data. Nothing written here may, because a reader that is handed one and no descriptor refuses the whole package.
pub(crate) fn any_local_header_defers_its_sizes(bytes: &[u8]) -> bool {
    let mut at = 0usize;
    let mut found = false;
    while at + 30 <= bytes.len() {
        if bytes[at..at + 4] != LOCAL_FILE_HEADER.to_le_bytes() {
            break;
        }
        found |= zip::local_header_defers_its_sizes(bytes, at);
        let name_length = u16(bytes, at + 26) as usize;
        let extra_length = u16(bytes, at + 28) as usize;
        let packed = u32(bytes, at + 18) as usize;
        at += 30 + name_length + extra_length + packed;
    }
    found
}

/// The blocks a reader produced, so a test can ask what a range really points at rather than reading it back out of the drawn page.
pub(crate) fn blocks(bytes: &[u8], format: DocumentFormat) -> Option<Vec<OfficeBlock>> {
    let archive = Archive::read(bytes).ok()?;
    Some(read_document(&archive, format).ok()?.blocks)
}

/// One stored member written with its sizes in a trailing data descriptor, the shape two of three real Word documents carry on every member.
pub(crate) fn archive_with_data_descriptor(name: &str, contents: &str) -> Vec<u8> {
    archive_deferring_every_size(&[(name, contents.as_bytes())])
}

/// A whole package written that way: every member stored, every local header claiming its sizes follow the data, and a descriptor after each. Our own writer cannot produce this and must not, so it is built here against the specification — which is the only way a save is proved on the shape it exists to fix.
pub(crate) fn archive_deferring_every_size(members: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut offsets = Vec::with_capacity(members.len());
    let mut sums = Vec::with_capacity(members.len());
    for (name, data) in members {
        let mut crc = flate2::Crc::new();
        crc.update(data);
        let crc = crc.sum();
        offsets.push(out.len());
        sums.push(crc);
        // The flag says the sizes come later, and the three fields the header would carry are written as zero.
        out.extend_from_slice(&local_header(name, 8, METHOD_STORED, 0, 0, 0));
        out.extend_from_slice(data);
        out.extend_from_slice(&DATA_DESCRIPTOR.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    }
    let directory_at = out.len();
    for (index, (name, data)) in members.iter().enumerate() {
        out.extend_from_slice(&central_entry(
            name,
            8,
            METHOD_STORED,
            sums[index],
            data.len(),
            data.len(),
            offsets[index],
        ));
    }
    finish(&mut out, directory_at, members.len() as u16);
    out
}

/// An archive carrying a folder entry beside its one real member, the shape both real presentations carry nineteen of.
pub(crate) fn archive_with_directory_entries(name: &str, contents: &str) -> Vec<u8> {
    let folder = "parts/";
    let data = contents.as_bytes();
    let mut crc = flate2::Crc::new();
    crc.update(data);
    let crc = crc.sum();

    let mut out = Vec::new();
    let folder_at = out.len();
    out.extend_from_slice(&local_header(folder, 0, METHOD_STORED, 0, 0, 0));
    let member_at = out.len();
    out.extend_from_slice(&local_header(
        name,
        0,
        METHOD_STORED,
        crc,
        data.len(),
        data.len(),
    ));
    out.extend_from_slice(data);

    let directory_at = out.len();
    out.extend_from_slice(&central_entry(folder, 0, METHOD_STORED, 0, 0, 0, folder_at));
    out.extend_from_slice(&central_entry(
        name,
        0,
        METHOD_STORED,
        crc,
        data.len(),
        data.len(),
        member_at,
    ));
    finish(&mut out, directory_at, 2);
    out
}

/// One deflated member of `unpacked` zero bytes whose directory claims it unpacks to `claimed`, whatever it really unpacks to.
///
/// Both halves of the member ceiling need a file this tree's own writer cannot make: it puts the true size in front of every member, so nothing it writes can claim four gigabytes it does not hold. The zeros are deflated a block at a time so proving the ceiling costs no quarter-gigabyte source buffer beside the inflated one.
pub(crate) fn archive_of_zeros(name: &str, unpacked: usize, claimed: usize) -> Vec<u8> {
    let block = [0u8; 64 * 1024];
    let mut crc = flate2::Crc::new();
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::fast());
    let mut left = unpacked;
    while left > 0 {
        let take = left.min(block.len());
        crc.update(&block[..take]);
        encoder
            .write_all(&block[..take])
            .expect("a run of zeros deflates");
        left -= take;
    }
    let crc = crc.sum();
    let packed = encoder.finish().expect("the deflate stream finishes");

    let mut out = Vec::new();
    out.extend_from_slice(&local_header(
        name,
        0,
        METHOD_DEFLATED,
        crc,
        packed.len(),
        unpacked,
    ));
    out.extend_from_slice(&packed);
    let directory_at = out.len();
    out.extend_from_slice(&central_entry(
        name,
        0,
        METHOD_DEFLATED,
        crc,
        packed.len(),
        claimed,
        0,
    ));
    finish(&mut out, directory_at, 1);
    out
}

fn local_header(
    name: &str,
    flags: u16,
    method: u16,
    crc: u32,
    packed: usize,
    unpacked: usize,
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&LOCAL_FILE_HEADER.to_le_bytes());
    out.extend_from_slice(&20u16.to_le_bytes());
    out.extend_from_slice(&flags.to_le_bytes());
    out.extend_from_slice(&method.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&crc.to_le_bytes());
    out.extend_from_slice(&(packed as u32).to_le_bytes());
    out.extend_from_slice(&(unpacked as u32).to_le_bytes());
    out.extend_from_slice(&(name.len() as u16).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(name.as_bytes());
    out
}

fn central_entry(
    name: &str,
    flags: u16,
    method: u16,
    crc: u32,
    packed: usize,
    unpacked: usize,
    local_at: usize,
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&CENTRAL_FILE_HEADER.to_le_bytes());
    out.extend_from_slice(&20u16.to_le_bytes());
    out.extend_from_slice(&20u16.to_le_bytes());
    out.extend_from_slice(&flags.to_le_bytes());
    out.extend_from_slice(&method.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&crc.to_le_bytes());
    out.extend_from_slice(&(packed as u32).to_le_bytes());
    out.extend_from_slice(&(unpacked as u32).to_le_bytes());
    out.extend_from_slice(&(name.len() as u16).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(local_at as u32).to_le_bytes());
    out.extend_from_slice(name.as_bytes());
    out
}

fn finish(out: &mut Vec<u8>, directory_at: usize, count: u16) {
    let directory_size = out.len() - directory_at;
    out.extend_from_slice(&END_OF_CENTRAL_DIRECTORY.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&(directory_size as u32).to_le_bytes());
    out.extend_from_slice(&(directory_at as u32).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
}

fn u16(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes(bytes[at..at + 2].try_into().expect("two bytes"))
}

fn u32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().expect("four bytes"))
}
