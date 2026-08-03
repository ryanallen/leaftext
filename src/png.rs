//! PNG out, as small as we can make it losslessly.
//!
//! Two choices, both against what a canvas or a library would do, and both for the same reason: a diagram and a page of text are flat fill, not gradient.
//!
//! - **Every row unfiltered.** Filters turn a gradient into small numbers, and
//!   the per-row heuristic every encoder uses picks them by smallest sum of
//!   deviations. On flat pixels it loses: a 1522×1212 page came to 219 KB
//!   filtered against 94 KB not.
//! - **A palette when 256 colors fit**, one byte a pixel instead of three, and
//!   exact, because the palette holds the colors already there. Above that it is
//!   truecolor, which is where a screenshot lands.
//!
//! Either way the output is pixel-for-pixel the input.

use std::collections::HashMap;

use flate2::{write::ZlibEncoder, Compression};
use std::io::Write;

/// The largest palette PNG allows. Past this the image goes out as truecolor.
const MAX_PALETTE: usize = 256;

/// Encode `rgba` (4 bytes per pixel, row-major, no padding) as a PNG.
///
/// Alpha is dropped when every pixel is opaque, which is every export the sheet makes — it paints its own background first, because a PNG dropped into something with a page color of its own has no transparency to fall back on.
pub fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let pixels = (width as usize).checked_mul(height as usize)?;
    if width == 0 || height == 0 || rgba.len() < pixels.checked_mul(4)? {
        return None;
    }
    let opaque = rgba.chunks_exact(4).all(|pixel| pixel[3] == 255);

    // One entry per distinct color, in first-seen order so the palette is stable for the same drawing.
    let mut lookup: HashMap<[u8; 4], u8> = HashMap::new();
    let mut palette: Vec<[u8; 4]> = Vec::new();
    let mut indexed: Vec<u8> = Vec::with_capacity(pixels);
    let mut too_many = false;
    for pixel in rgba.chunks_exact(4).take(pixels) {
        let key = [pixel[0], pixel[1], pixel[2], pixel[3]];
        match lookup.get(&key) {
            Some(index) => indexed.push(*index),
            None => {
                if palette.len() == MAX_PALETTE {
                    too_many = true;
                    break;
                }
                let index = palette.len() as u8;
                palette.push(key);
                lookup.insert(key, index);
                indexed.push(index);
            }
        }
    }

    // Opaque as well as small enough: a palette carrying transparency needs a tRNS chunk beside it, and nothing exports with real alpha.
    if !too_many && opaque {
        return Some(write_png(
            width,
            height,
            ColorType::Indexed(&palette),
            &unfiltered(&indexed, width as usize, height as usize),
        ));
    }

    let channels = if opaque { 3 } else { 4 };
    let mut raw = Vec::with_capacity(pixels * channels);
    for pixel in rgba.chunks_exact(4).take(pixels) {
        raw.extend_from_slice(&pixel[..channels]);
    }
    Some(write_png(
        width,
        height,
        if opaque {
            ColorType::Rgb
        } else {
            ColorType::Rgba
        },
        &unfiltered(&raw, width as usize * channels, height as usize),
    ))
}

/// The same encoder, but the image is cut down to 256 colors first so it can take the palette path. For a screenshot — text on flat fill — that is where the real saving is: measured on a 1522×1212 page, 213 KB truecolor against 94 KB paletted. It moves pixels, so it is never what an export uses; documentation images ask for it because a page that loads is worth more than a color nobody can see is wrong.
pub fn encode_rgba_paletted(rgba: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let pixels = (width as usize).checked_mul(height as usize)?;
    if width == 0 || height == 0 || rgba.len() < pixels.checked_mul(4)? {
        return None;
    }
    if rgba.chunks_exact(4).any(|pixel| pixel[3] != 255) {
        // Transparency would need a tRNS chunk to survive the palette, and no screenshot has any: better to write the honest truecolor file.
        return encode_rgba(rgba, width, height);
    }

    let mut counts: HashMap<[u8; 3], u32> = HashMap::new();
    for pixel in rgba.chunks_exact(4).take(pixels) {
        *counts.entry([pixel[0], pixel[1], pixel[2]]).or_insert(0) += 1;
    }
    if counts.len() <= MAX_PALETTE {
        // Nothing to cut: the exact palette already fits, so this is lossless.
        return encode_rgba(rgba, width, height);
    }

    // Median cut. Split the box that spans the most on one axis, at the median along that axis, until there are 256 of them. Each box then answers with the mean of the colors inside it, weighted by how many pixels they cover — an average, so an antialiased edge lands between its neighbors rather than snapping to whichever corner of the box was picked.
    let mut boxes: Vec<Vec<([u8; 3], u32)>> = vec![counts.into_iter().collect()];
    while boxes.len() < MAX_PALETTE {
        let Some((at, axis)) = boxes
            .iter()
            .enumerate()
            .filter(|(_, colors)| colors.len() > 1)
            .map(|(at, colors)| {
                let mut widest = (0usize, 0u8);
                for axis in 0..3 {
                    let low = colors.iter().map(|(c, _)| c[axis]).min().unwrap_or(0);
                    let high = colors.iter().map(|(c, _)| c[axis]).max().unwrap_or(0);
                    if high - low >= widest.1 {
                        widest = (axis, high - low);
                    }
                }
                (at, widest)
            })
            .max_by_key(|(_, (_, span))| *span)
            .map(|(at, (axis, _))| (at, axis))
        else {
            break;
        };
        let mut colors = boxes.swap_remove(at);
        colors.sort_unstable_by_key(|(color, _)| color[axis]);
        let half = colors.len() / 2;
        let rest = colors.split_off(half.max(1));
        boxes.push(colors);
        boxes.push(rest);
    }

    let mut palette: Vec<[u8; 4]> = Vec::with_capacity(boxes.len());
    let mut lookup: HashMap<[u8; 3], u8> = HashMap::new();
    for (index, colors) in boxes.iter().enumerate() {
        let weight: u64 = colors.iter().map(|(_, n)| u64::from(*n)).sum();
        let mut mean = [0u8; 4];
        for axis in 0..3 {
            let total: u64 = colors
                .iter()
                .map(|(color, n)| u64::from(color[axis]) * u64::from(*n))
                .sum();
            mean[axis] = (total / weight.max(1)) as u8;
        }
        mean[3] = 255;
        palette.push(mean);
        for (color, _) in colors {
            lookup.insert(*color, index as u8);
        }
    }

    let mut indexed = Vec::with_capacity(pixels);
    for pixel in rgba.chunks_exact(4).take(pixels) {
        indexed.push(*lookup.get(&[pixel[0], pixel[1], pixel[2]])?);
    }
    Some(write_png(
        width,
        height,
        ColorType::Indexed(&palette),
        &unfiltered(&indexed, width as usize, height as usize),
    ))
}

enum ColorType<'a> {
    Rgb,
    Rgba,
    Indexed(&'a [[u8; 4]]),
}

/// Every scanline prefixed with filter byte 0. See the module note for why none of the other four is tried.
fn unfiltered(raw: &[u8], stride: usize, height: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(height * (stride + 1));
    for row in 0..height {
        out.push(0);
        out.extend_from_slice(&raw[row * stride..row * stride + stride]);
    }
    out
}

fn write_png(width: u32, height: u32, color: ColorType<'_>, scanlines: &[u8]) -> Vec<u8> {
    let mut header = Vec::with_capacity(13);
    header.extend_from_slice(&width.to_be_bytes());
    header.extend_from_slice(&height.to_be_bytes());
    header.push(8); // bit depth
    header.push(match color {
        ColorType::Rgb => 2,
        ColorType::Indexed(_) => 3,
        ColorType::Rgba => 6,
    });
    header.extend_from_slice(&[0, 0, 0]); // deflate, no filtering beyond the row byte, no interlace

    let mut png = Vec::with_capacity(scanlines.len() / 2);
    png.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    push_chunk(&mut png, b"IHDR", &header);
    if let ColorType::Indexed(palette) = color {
        let mut plte = Vec::with_capacity(palette.len() * 3);
        for entry in palette {
            plte.extend_from_slice(&entry[..3]);
        }
        push_chunk(&mut png, b"PLTE", &plte);
    }
    let mut deflate = ZlibEncoder::new(Vec::new(), Compression::best());
    // Writing to a Vec cannot fail, so neither of these can.
    let _ = deflate.write_all(scanlines);
    let data = deflate.finish().unwrap_or_default();
    push_chunk(&mut png, b"IDAT", &data);
    push_chunk(&mut png, b"IEND", &[]);
    png
}

fn push_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let start = out.len();
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let crc = crc32(&out[start..]);
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let carry = crc & 1;
            crc >>= 1;
            if carry != 0 {
                crc ^= 0xedb8_8320;
            }
        }
    }
    !crc
}

/// A 24- or 32-bit uncompressed BMP, as RGBA. The screenshot tool writes BMP because Windows can save one without an encoder of its own, and this is how those pixels reach [`encode_rgba`] — so the documentation images and the flowchart export go out through exactly the same encoder.
pub fn rgba_from_bmp(bmp: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    if bmp.len() < 54 || &bmp[..2] != b"BM" {
        return None;
    }
    let read32 =
        |at: usize| -> u32 { u32::from_le_bytes([bmp[at], bmp[at + 1], bmp[at + 2], bmp[at + 3]]) };
    let offset = read32(10) as usize;
    let width = read32(18);
    // A negative height means the rows are already top-down.
    let raw_height = read32(22) as i32;
    let flipped = raw_height > 0;
    let height = raw_height.unsigned_abs();
    let bits = u16::from_le_bytes([bmp[28], bmp[29]]);
    if width == 0 || height == 0 || (bits != 24 && bits != 32) {
        return None;
    }
    let channels = (bits / 8) as usize;
    let stride = (width as usize * channels + 3) & !3;
    if bmp.len() < offset + stride * height as usize {
        return None;
    }
    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    for y in 0..height as usize {
        let source_row = if flipped { height as usize - 1 - y } else { y };
        let row = offset + source_row * stride;
        for x in 0..width as usize {
            let at = row + x * channels;
            let to = (y * width as usize + x) * 4;
            // BMP stores blue first.
            rgba[to] = bmp[at + 2];
            rgba[to + 1] = bmp[at + 1];
            rgba[to + 2] = bmp[at];
            rgba[to + 3] = if channels == 4 { bmp[at + 3] } else { 255 };
        }
    }
    Some((rgba, width, height))
}
