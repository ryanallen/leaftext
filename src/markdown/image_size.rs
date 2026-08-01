//! An image's own pixel size, read out of its header and stamped onto the tag.
//!
//! Without it every picture lands at nothing and grows when it decodes, reflowing
//! the document and moving the words under the reader's eyes. Only the ratio is
//! needed: `width`/`height` against the stylesheet's `height: auto` holds the box.

use super::*;

/// How much of a file we read looking for its size. Every format but JPEG answers
/// in the first few dozen bytes; JPEG hides its frame header behind whatever EXIF
/// block comes first, and 64 KiB clears the thumbnails those carry.
const IMAGE_HEADER_READ_LIMIT: u64 = 64 * 1024;

/// Give up rather than write a number the page would have to scroll around: a
/// size this big is a corrupt header read as one, not a picture.
const IMAGE_MAX_PIXEL_SIZE: u32 = 100_000;

/// Add `width` and `height` to every local image. After the sanitizer on purpose:
/// the numbers are ours, so `img` keeps the attribute allowlist it was given —
/// which is what strips a document's own sizing before we get here.
pub(crate) fn stamp_image_intrinsic_sizes(html: &str, source_path: &Path) -> String {
    let Some(source_dir) = local_image_source_dir(source_path) else {
        return html.to_string();
    };

    let mut stamped = String::with_capacity(html.len());
    let mut sizes: HashMap<PathBuf, Option<(u32, u32)>> = HashMap::new();
    let mut offset = 0usize;
    let lower_html = html.to_ascii_lowercase();

    while let Some(relative_start) = lower_html[offset..].find("<img") {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            break;
        };
        let tag = &html[tag_start..tag_end];

        stamped.push_str(&html[offset..tag_start]);
        stamped.push_str(&stamp_img_tag(tag, &source_dir, &mut sizes));
        offset = tag_end;
    }

    stamped.push_str(&html[offset..]);
    stamped
}

fn stamp_img_tag(
    tag: &str,
    source_dir: &Path,
    sizes: &mut HashMap<PathBuf, Option<(u32, u32)>>,
) -> String {
    let Some(src) = find_html_attribute(tag, "src") else {
        return tag.to_string();
    };
    let Some(path) = local_image_protocol_path(src.value, source_dir) else {
        return tag.to_string();
    };
    let size = *sizes
        .entry(path.clone())
        .or_insert_with(|| image_pixel_size(&path));
    let Some((width, height)) = size else {
        return tag.to_string();
    };

    // Before the `>`, or the `/` of a `/>`, so the tag stays the shape it was.
    let close = if tag.ends_with("/>") { 2 } else { 1 };
    let insert_at = tag.len() - close;
    format!(
        r#"{} width="{width}" height="{height}"{}"#,
        tag[..insert_at].trim_end(),
        &tag[insert_at..]
    )
}

/// The image's size in pixels, or `None` for a file we can't read, a format we
/// don't know, or a header that doesn't make sense.
pub(crate) fn image_pixel_size(path: &Path) -> Option<(u32, u32)> {
    let header = read_image_header(path)?;
    let size = png_pixel_size(&header)
        .or_else(|| gif_pixel_size(&header))
        .or_else(|| bmp_pixel_size(&header))
        .or_else(|| webp_pixel_size(&header))
        .or_else(|| jpeg_pixel_size(&header))
        .or_else(|| svg_pixel_size(&header))?;

    (size.0 > 0 && size.1 > 0 && size.0 <= IMAGE_MAX_PIXEL_SIZE && size.1 <= IMAGE_MAX_PIXEL_SIZE)
        .then_some(size)
}

fn read_image_header(path: &Path) -> Option<Vec<u8>> {
    use io::Read;

    let mut header = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(IMAGE_HEADER_READ_LIMIT)
        .read_to_end(&mut header)
        .ok()?;
    Some(header)
}

fn big_endian_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn big_endian_u16(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?) as u32)
}

fn little_endian_u16(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?) as u32)
}

fn little_endian_i32(bytes: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// PNG, and APNG with it: both open with the same signature and IHDR block.
fn png_pixel_size(header: &[u8]) -> Option<(u32, u32)> {
    if !header.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some((big_endian_u32(header, 16)?, big_endian_u32(header, 20)?))
}

fn gif_pixel_size(header: &[u8]) -> Option<(u32, u32)> {
    if !header.starts_with(b"GIF87a") && !header.starts_with(b"GIF89a") {
        return None;
    }
    Some((little_endian_u16(header, 6)?, little_endian_u16(header, 8)?))
}

/// BMP writes its height upside down when the rows are stored bottom-up, which is
/// the usual way, so the sign is a row order and not a size.
fn bmp_pixel_size(header: &[u8]) -> Option<(u32, u32)> {
    if !header.starts_with(b"BM") {
        return None;
    }
    let width = little_endian_i32(header, 18)?;
    let height = little_endian_i32(header, 22)?;
    Some((width.unsigned_abs(), height.unsigned_abs()))
}

/// WebP is three formats behind one signature, each keeping the size somewhere
/// else: lossy in the VP8 frame header, lossless packed into bit fields, and
/// extended in a canvas block that stores each side one short.
fn webp_pixel_size(header: &[u8]) -> Option<(u32, u32)> {
    if !header.starts_with(b"RIFF") || header.get(8..12)? != b"WEBP" {
        return None;
    }
    match header.get(12..16)? {
        b"VP8 " => {
            if header.get(23..26)? != [0x9d, 0x01, 0x2a] {
                return None;
            }
            Some((
                little_endian_u16(header, 26)? & 0x3fff,
                little_endian_u16(header, 28)? & 0x3fff,
            ))
        }
        b"VP8L" => {
            if *header.get(20)? != 0x2f {
                return None;
            }
            let bits = u32::from_le_bytes(header.get(21..25)?.try_into().ok()?);
            Some((((bits & 0x3fff) + 1), (((bits >> 14) & 0x3fff) + 1)))
        }
        b"VP8X" => {
            let side = |at: usize| -> Option<u32> {
                let bytes = header.get(at..at + 3)?;
                Some(u32::from(bytes[0]) | u32::from(bytes[1]) << 8 | u32::from(bytes[2]) << 16)
            };
            Some((side(24)? + 1, side(27)? + 1))
        }
        _ => None,
    }
}

/// Walk the JPEG segment chain to the start-of-frame, which is the only marker
/// carrying the size. Everything before it is metadata of some length we skip.
fn jpeg_pixel_size(header: &[u8]) -> Option<(u32, u32)> {
    if !header.starts_with(b"\xff\xd8") {
        return None;
    }
    let mut at = 2usize;
    loop {
        // Any run of 0xff between segments is padding.
        while *header.get(at)? == 0xff && *header.get(at + 1)? == 0xff {
            at += 1;
        }
        if *header.get(at)? != 0xff {
            return None;
        }
        let marker = *header.get(at + 1)?;
        // Start of scan, or the image itself: past anything that states a size.
        if marker == 0xda || marker == 0xd9 {
            return None;
        }
        let length = big_endian_u16(header, at + 2)? as usize;
        if length < 2 {
            return None;
        }
        // SOF0..SOF15, less the three that are not frames at all (DHT, JPG, DAC).
        if (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
            return Some((
                big_endian_u16(header, at + 7)?,
                big_endian_u16(header, at + 5)?,
            ));
        }
        at += 2 + length;
    }
}

/// An SVG states a size in its own attributes, or implies one with the box it
/// draws in. Either gives the ratio, which is all the page needs.
fn svg_pixel_size(header: &[u8]) -> Option<(u32, u32)> {
    // Lossy: an SVG can carry any text at all, and a stray byte in a comment must
    // not cost the size that sits in the tag.
    let text = String::from_utf8_lossy(header);
    let start = text.find("<svg")?;
    let tag = &text[start..find_html_tag_end(&text, start)?];

    let length = |name: &str| -> Option<f64> {
        let value = find_html_attribute(tag, name)?.value.trim().to_string();
        // A percentage sizes against the page, not the drawing, so it says nothing.
        if value.ends_with('%') {
            return None;
        }
        let digits: String = value
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
            .collect();
        digits.parse::<f64>().ok().filter(|number| *number > 0.0)
    };

    if let (Some(width), Some(height)) = (length("width"), length("height")) {
        return Some((width.round() as u32, height.round() as u32));
    }

    let box_numbers: Vec<f64> = find_html_attribute(tag, "viewBox")?
        .value
        .split([' ', ',', '\t', '\n', '\r'])
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<f64>().ok())
        .collect();
    let [_, _, width, height] = box_numbers.as_slice() else {
        return None;
    };
    (*width > 0.0 && *height > 0.0).then(|| (width.round() as u32, height.round() as u32))
}
