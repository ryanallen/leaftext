//! The PNG encoder. It writes the file a person keeps, so the bytes have to be a real PNG and the pixels have to survive.

use super::*;
use std::io::Read;

/// Inflate an IDAT and walk the scanlines back out. Filter 0 only, which is all the encoder writes — a test that accepted any filter would stop proving that.
fn scanlines(png: &[u8], stride: usize, height: usize) -> Vec<u8> {
    let mut at = 8;
    let mut idat = Vec::new();
    let mut palette = Vec::new();
    let mut color_type = 0;
    while at + 8 <= png.len() {
        let len = u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]) as usize;
        let kind = &png[at + 4..at + 8];
        let body = &png[at + 8..at + 8 + len];
        match kind {
            b"IHDR" => color_type = body[9],
            b"PLTE" => palette = body.to_vec(),
            b"IDAT" => idat.extend_from_slice(body),
            _ => {}
        }
        at += 12 + len;
    }
    let mut raw = Vec::new();
    flate2::read::ZlibDecoder::new(idat.as_slice())
        .read_to_end(&mut raw)
        .expect("IDAT inflates");
    assert_eq!(
        raw.len(),
        height * (stride + 1),
        "one filter byte per scanline and nothing else"
    );

    let mut out = Vec::with_capacity(height * stride);
    for row in raw.chunks_exact(stride + 1) {
        assert_eq!(row[0], 0, "every row is written unfiltered");
        out.extend_from_slice(&row[1..]);
    }
    if color_type == 3 {
        // Resolve the palette so the caller can compare colors, not indices.
        let mut resolved = Vec::with_capacity(out.len() * 3);
        for index in &out {
            let at = *index as usize * 3;
            resolved.extend_from_slice(&palette[at..at + 3]);
        }
        return resolved;
    }
    out
}

fn chunk_kinds(png: &[u8]) -> Vec<String> {
    let mut kinds = Vec::new();
    let mut at = 8;
    while at + 8 <= png.len() {
        let len = u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]) as usize;
        kinds.push(String::from_utf8_lossy(&png[at + 4..at + 8]).into_owned());
        at += 12 + len;
    }
    kinds
}

/// A flowchart is flat fill and few colors, so it goes out as a palette — one byte a pixel instead of three, and exact, because the palette holds the colors the drawing already had.
#[test]
fn few_colors_go_out_as_an_exact_palette() {
    let width = 8;
    let height = 4;
    let mut rgba = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let paint: [u8; 4] = if (x + y) % 3 == 0 {
                [0x1f, 0x88, 0x3d, 255]
            } else {
                [0xff, 0xff, 0xff, 255]
            };
            rgba.extend_from_slice(&paint);
        }
    }
    let png = encode_rgba(&rgba, width as u32, height as u32).expect("encodes");
    assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    let kinds = chunk_kinds(&png);
    assert_eq!(
        kinds,
        vec!["IHDR", "PLTE", "IDAT", "IEND"],
        "a palette image needs its PLTE, and nothing else is written"
    );

    // Two colors in, two colors out, in the same places.
    let pixels = scanlines(&png, width * 1, height);
    let expected: Vec<u8> = rgba
        .chunks_exact(4)
        .flat_map(|pixel| pixel[..3].to_vec())
        .collect();
    assert_eq!(pixels, expected, "the palette resolves back to the drawing");
}

/// Past 256 colors there is no palette to be had, so it goes out as truecolor — still unfiltered, still exactly the pixels handed over.
#[test]
fn many_colors_go_out_as_truecolor_and_keep_every_pixel() {
    let width = 40;
    let height = 20;
    let mut rgba = Vec::new();
    for y in 0..height {
        for x in 0..width {
            rgba.extend_from_slice(&[(x * 6) as u8, (y * 13) as u8, (x * y) as u8, 255]);
        }
    }
    let png = encode_rgba(&rgba, width as u32, height as u32).expect("encodes");
    assert_eq!(
        chunk_kinds(&png),
        vec!["IHDR", "IDAT", "IEND"],
        "no palette fits, so none is written"
    );
    let pixels = scanlines(&png, width * 3, height);
    let expected: Vec<u8> = rgba
        .chunks_exact(4)
        .flat_map(|pixel| pixel[..3].to_vec())
        .collect();
    assert_eq!(pixels, expected, "truecolor keeps every pixel");
}

/// Transparency survives: alpha is only dropped when every pixel is opaque.
#[test]
fn alpha_is_kept_when_some_of_it_is_real() {
    let rgba = vec![
        10, 20, 30, 255, //
        40, 50, 60, 128, //
    ];
    let png = encode_rgba(&rgba, 2, 1).expect("encodes");
    let pixels = scanlines(&png, 2 * 4, 1);
    assert_eq!(
        pixels, rgba,
        "an image with real alpha keeps all four channels"
    );
}

/// Nothing to encode is a refusal, not an empty file that looks like a picture.
#[test]
fn a_bad_size_is_refused() {
    assert!(encode_rgba(&[], 0, 0).is_none());
    assert!(
        encode_rgba(&[1, 2, 3, 4], 4, 4).is_none(),
        "not enough pixels"
    );
}

/// The screenshot tool writes a BMP because Windows can save one without an encoder; this is the only reason that path exists, so it has to round-trip.
#[test]
fn a_bottom_up_bmp_comes_back_the_right_way_up() {
    // 2x2, 24-bit, rows bottom-up, each padded to 4 bytes. Blue first.
    let mut bmp = vec![0u8; 54];
    bmp[0] = b'B';
    bmp[1] = b'M';
    bmp[10..14].copy_from_slice(&54u32.to_le_bytes()); // pixel offset
    bmp[18..22].copy_from_slice(&2u32.to_le_bytes()); // width
    bmp[22..26].copy_from_slice(&2u32.to_le_bytes()); // height, positive = bottom-up
    bmp[28..30].copy_from_slice(&24u16.to_le_bytes()); // bits
                                                       // Bottom row first: (blue, green) then the top row: (red, white).
    bmp.extend_from_slice(&[255, 0, 0, 0, 255, 0, 0, 0]);
    bmp.extend_from_slice(&[0, 0, 255, 255, 255, 255, 0, 0]);

    let (rgba, width, height) = rgba_from_bmp(&bmp).expect("reads");
    assert_eq!((width, height), (2, 2));
    assert_eq!(
        rgba,
        vec![
            255, 0, 0, 255, // top-left is red
            255, 255, 255, 255, // top-right is white
            0, 0, 255, 255, // bottom-left is blue
            0, 255, 0, 255, // bottom-right is green
        ],
        "a bottom-up BMP is flipped, and its blue-first order undone"
    );

    assert!(rgba_from_bmp(&[]).is_none());
    assert!(rgba_from_bmp(b"not a bitmap at all........").is_none());
}
