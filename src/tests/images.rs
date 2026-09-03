//! Image URL resolution and the `leaf-image://` protocol.

use super::*;

/// The broken-image mark is an icon class over a transparent pixel. Miss any of the four — the class, the pixel, the ink, the CSP grant — and it is the platform's own mark back, or an empty box.
#[test]
fn the_missing_image_glyph_is_inlined_painted_and_allowed() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The drawing is in the stylesheet, as a class, not in the page.
    assert_contains(css, ".lt-icon-missing-image {");
    assert_contains(css, "M6.3,22.1c-1.1,0-2-.9-2-2V4.1");
    // Not drawn into the page's markup. The script carries the same path once more, as one entry of the icon set a diagram box draws from — generated from the same row, so there is still one drawing of it.
    assert!(
        !app_shell_html().contains("M6.3,22.1c-1.1,0-2-.9-2-2V4.1"),
        "the mark must not be pasted into the page as well"
    );
    for expected in [
        // The element stays an <img> so a re-fetch can put the real picture back, and a source it can load keeps the platform's own broken glyph away.
        "img.classList.add('lt-icon', 'lt-icon-missing-image');",
        "img.src = TRANSPARENT_PIXEL;",
        "data:image/gif;base64,",
        // Its own source is kept, so a re-fetch can find the file if it arrives.
        "img.dataset.imageMissingSrc = img.getAttribute('src')",
        "restoreMissingImage(img);",
        "img.classList.remove('lt-icon', 'lt-icon-missing-image');",
    ] {
        assert_contains(&html, expected);
    }
    // The ink is the rule's, so a theme change repaints it with no work in the page.
    assert_contains(
        rule_body(css, ".document-body img[data-image-missing=\"true\"] {"),
        "background-color: var(--lt-muted-foreground);",
    );
    // No icon is substituted into the page at all now. Checked against the page itself: the script legitimately writes `{{` — it is mermaid's hexagon.
    assert!(
        !app_shell_html().contains("_ICON_SVG}}"),
        "the page must carry no icon placeholder"
    );

    let img_src = html
        .lines()
        .find(|line| line.contains("Content-Security-Policy"))
        .expect("shell declares a Content-Security-Policy")
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("img-src"))
        .expect("CSP declares an explicit img-src directive");

    assert!(
        img_src.contains("data:"),
        "img-src must allow data: or the glyph never draws: {img_src}"
    );
}

/// Every format the reading view can be handed, each stating 5 by 9 in its own way, so the page can reserve the space before the picture decodes. A file we can't read the size out of is left alone rather than guessed at.
#[test]
fn reads_the_pixel_size_out_of_each_image_header() {
    let dir = scratch_dir("image-size");

    let mut png = tiny_png_bytes().to_vec();
    png[16..20].copy_from_slice(&5u32.to_be_bytes());
    png[20..24].copy_from_slice(&9u32.to_be_bytes());

    let mut gif = b"GIF89a".to_vec();
    gif.extend_from_slice(&5u16.to_le_bytes());
    gif.extend_from_slice(&9u16.to_le_bytes());

    // Rows stored bottom-up, so the height arrives negative — an order, not a size.
    let mut bmp = b"BM".to_vec();
    bmp.resize(18, 0);
    bmp.extend_from_slice(&5i32.to_le_bytes());
    bmp.extend_from_slice(&(-9i32).to_le_bytes());

    let mut lossy = b"RIFF\0\0\0\0WEBPVP8 \0\0\0\0".to_vec();
    lossy.extend_from_slice(&[0, 0, 0, 0x9d, 0x01, 0x2a]);
    lossy.extend_from_slice(&5u16.to_le_bytes());
    lossy.extend_from_slice(&9u16.to_le_bytes());

    let mut lossless = b"RIFF\0\0\0\0WEBPVP8L\0\0\0\0\x2f".to_vec();
    lossless.extend_from_slice(&(4u32 | (8u32 << 14)).to_le_bytes());

    let mut extended = b"RIFF\0\0\0\0WEBPVP8X\0\0\0\0\0\0\0\0".to_vec();
    extended.extend_from_slice(&[4, 0, 0, 8, 0, 0]);

    // An APP0 block first, so the frame header is reached by walking the chain.
    let mut jpeg = vec![
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 8,
    ];
    jpeg.extend_from_slice(&9u16.to_be_bytes());
    jpeg.extend_from_slice(&5u16.to_be_bytes());

    let cases: [(&str, Vec<u8>, Option<(u32, u32)>); 10] = [
        ("header.png", png, Some((5, 9))),
        ("header.gif", gif, Some((5, 9))),
        ("header.bmp", bmp, Some((5, 9))),
        ("lossy.webp", lossy, Some((5, 9))),
        ("lossless.webp", lossless, Some((5, 9))),
        ("extended.webp", extended, Some((5, 9))),
        ("header.jpg", jpeg, Some((5, 9))),
        (
            "sized.svg",
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="5px" height="9"></svg>"#.to_vec(),
            Some((5, 9)),
        ),
        (
            // A percentage sizes against the page, so the box is the only answer.
            "boxed.svg",
            br#"<svg width="100%" viewBox="0 0 5 9"></svg>"#.to_vec(),
            Some((5, 9)),
        ),
        ("not-an-image.png", b"nothing of the sort".to_vec(), None),
    ];

    let read: Vec<(&str, Option<(u32, u32)>)> = cases
        .iter()
        .map(|(name, bytes, _)| {
            let path = dir.join(name);
            fs::write(&path, bytes).expect("test image is written");
            (*name, image_pixel_size(&path))
        })
        .collect();

    fs::remove_dir_all(&dir).expect("test image directory is removed");

    for ((name, _, expected), (_, actual)) in cases.iter().zip(read) {
        assert_eq!(actual, *expected, "{name}");
    }
    assert_eq!(image_pixel_size(&dir.join("gone.png")), None);
}

#[test]
fn sanitizer_allows_local_image_protocol_urls() {
    let sanitized = sanitize_rendered_html(
        r#"<img src="leaf-image://local/nested/space%20image.png" alt="x">"#,
    );

    assert_contains(
        &sanitized,
        r#"<img src="leaf-image://local/nested/space%20image.png" alt="x">"#,
    );
}

#[test]
fn sanitizer_allows_webview_local_image_workaround_urls() {
    let sanitized = sanitize_rendered_html(&format!(
        r#"<img src="{}" alt="x" onerror="alert(1)">"#,
        local_img("nested/space%20image.png")
    ));

    assert_contains(
        &sanitized,
        &expected_img("nested/space%20image.png", r#"alt="x""#),
    );
    assert!(!sanitized.contains("onerror"));
}

#[test]
fn renders_commonmark_code_blocks_links_images_and_rules() {
    let markdown = r#"Paragraph with `inline code`.

Paragraph with [a link](https://example.com).

[a titled link](https://example.com "Example title").

![Alt text](images/example.svg "Example image")

```rust
fn main() {}
```

~~~text
tilde fence
~~~

    indented code

---

***

___
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(&rendered.html, "<code>inline code</code>");
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com" rel="noopener noreferrer">a link</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com" title="Example title" rel="noopener noreferrer">a titled link</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<img src="images/example.svg" alt="Alt text" title="Example image">"#,
    );
    assert_contains(
        &rendered.html,
        "<pre class=\"highlight\" data-language=\"Rust\"><code class=\"language-rust\">",
    );
    assert_contains(
        &rendered.html,
        "<pre class=\"highlight\" data-language=\"Text\"><code class=\"language-text\">",
    );
    assert_contains(&rendered.html, "tilde fence");
    assert_contains(&rendered.html, "<pre><code>indented code");
    assert_eq!(rendered.html.matches("<hr>").count(), 3);
}

#[test]
fn uses_image_alt_text_as_title_tooltip_when_no_title_is_given() {
    let markdown = "![im the alt text in the box](images/example.svg)";

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<img src="images/example.svg" alt="im the alt text in the box" title="im the alt text in the box">"#,
    );
}

#[test]
fn keeps_explicit_image_title_over_alt_text() {
    let markdown = r#"![Alt text](images/example.svg "Real title")"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<img src="images/example.svg" alt="Alt text" title="Real title">"#,
    );
}

/// The Insert image window and the reading view read one table, so every picture that can be picked can be drawn.
#[test]
fn the_insert_image_window_offers_exactly_what_the_reading_view_draws() {
    assert_eq!(
        drawable_image_extensions(),
        vec!["apng", "avif", "bmp", "gif", "ico", "jfif", "jpeg", "jpg", "png", "svg", "webp",]
    );

    for ending in drawable_image_extensions() {
        assert!(
            is_local_image_path(Path::new(&format!("picture.{ending}"))),
            "the window offers .{ending} and the view will not draw it"
        );
    }

    // The Windows spelling of JPEG belongs in the same table.
    assert_eq!(
        local_image_mime_type(Path::new("scan.jfif")),
        local_image_mime_type(Path::new("scan.jpg"))
    );
    assert!(!is_local_image_path(Path::new("archive.zip")));
}

#[test]
fn changed_image_files_refresh_without_a_document_re_render() {
    // Only real image files take the refresh path; a changed .md is a document reload, and a stray file is neither.
    assert!(is_local_image_path(Path::new("imgs/themes/sage.png")));
    assert!(is_local_image_path(Path::new("/tmp/Diagram.SVG")));
    assert!(!is_local_image_path(Path::new("themes/sage.md")));
    assert!(!is_local_image_path(Path::new("notes.txt")));
    assert!(!is_local_image_path(Path::new("imgs/themes")));

    // The host asks the page to re-fetch, rather than re-rendering: the document text is unchanged, so a reload would hash-gate itself out anyway.
    assert_eq!(image_refresh_script(), "window.leafRefreshImages();");

    let html = app_shell_page();
    for expected in [
        "window.leafRefreshImages = () => {",
        "localImageEpoch += 1;",
        "const stamped = `${base}?leaf-epoch=${localImageEpoch}`;",
        "if (img.getAttribute('src') !== stamped) img.setAttribute('src', stamped);",
        // Every render stamps a fresh epoch, so reopening a document after an image was replaced on disk cannot show the cached copy.
        "    stampLocalImages();\n    laneWideTables();",
    ] {
        assert_contains(&html, expected);
    }
    // Only images served by the host's protocol are touched; remote and data URLs keep the src the document gave them.
    assert_contains(
        &html,
        "const LOCAL_IMAGE_SRC_PREFIXES = ['leaf-image://', 'http://leaf-image.', 'https://leaf-image.'];",
    );

    // The cache-busting query is inert on the way back in: the protocol handler resolves the path from the URL's segments and ignores the query.
    let source_dir = fixture_source_path("images");
    let path = local_image_protocol_path(
        &format!("{}?leaf-epoch=7", local_img("diagram.png")),
        &source_dir,
    )
    .expect("stamped local image url resolves");
    assert_eq!(path, source_dir.join("diagram.png"));
}

#[test]
fn resolves_relative_media_against_source_file_directory() {
    let markdown = "![Leaf logo](assets/logo.svg)";
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(&rendered.html, &expected_base_href(&source_path));
    assert_contains(
        &rendered.html,
        &expected_img("assets/logo.svg", r#"alt="Leaf logo" title="Leaf logo""#),
    );
}

/// A diagram box can hold a picture, and the page has no idea where the document sits — so a path beside it has to be resolved here, exactly as a Markdown image is. Only inside `@{ … }` and only that key: the same word in a label is the reader's own text.
#[test]
fn resolves_a_diagram_box_picture_the_way_a_markdown_image_resolves() {
    let source_path = fixture_source_path("project/README.md");
    let markdown = "```mermaid\nflowchart TD\n  A@{ img: \"assets/logo.svg\", label: \"Logo\" }\n  B[\"img: assets/logo.svg\"]\n```";

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(
        &rendered.html,
        &format!("img: \"{}\"", local_img("assets/logo.svg")),
    );
    // The same words in a label are text the reader typed, and a rewrite there would change what the diagram says.
    assert_contains(&rendered.html, "B[\"img: assets/logo.svg\"]");
    // The label beside it is untouched, and so is a remote address the web view can already fetch.
    assert_contains(&rendered.html, "label: \"Logo\"");
    let remote = render_markdown_document(
        "```mermaid\nflowchart TD\n  A@{ img: \"https://example.com/a.png\" }\n```",
        &source_path,
    );
    assert_contains(&remote.html, "img: \"https://example.com/a.png\"");
}

#[test]
fn renders_markdown_links_and_images_for_native_link_handling() {
    let markdown = r#"[External](https://example.com)
[Sibling](./other.md#install)
[Parent](../README.md)
[Escaped](./Nested%20Guide.md#heading)
[Text file](./notes/readme.txt)
[Reference][reference]
<https://example.org/autolink>
<leaf@example.com>

![Relative image](./images/example.svg "Example SVG")

<a href="./raw doc.md#html-heading" title="Raw doc">Raw HTML doc</a>
<img src="./raw image.png" alt="Raw image" title="Raw">

[reference]: ./refs/reference.md#target
"#;
    let source_path = fixture_source_path("project/nested/current.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(&rendered.html, &expected_base_href(&source_path));
    for expected in [
        r#"<a href="https://example.com" rel="noopener noreferrer">External</a>"#,
        r##"<a href="./other.md#install" rel="noopener noreferrer">Sibling</a>"##,
        r#"<a href="../README.md" rel="noopener noreferrer">Parent</a>"#,
        r##"<a href="./Nested%20Guide.md#heading" rel="noopener noreferrer">Escaped</a>"##,
        r#"<a href="./notes/readme.txt" rel="noopener noreferrer">Text file</a>"#,
        r##"<a href="./refs/reference.md#target" rel="noopener noreferrer">Reference</a>"##,
        r#"<a href="https://example.org/autolink" rel="noopener noreferrer">https://example.org/autolink</a>"#,
        r#"<a href="mailto:leaf@example.com" rel="noopener noreferrer">leaf@example.com</a>"#,
        r##"<a href="./raw doc.md#html-heading" title="Raw doc" rel="noopener noreferrer">Raw HTML doc</a>"##,
    ] {
        assert_contains(&rendered.html, expected);
    }
    assert_contains(
        &rendered.html,
        &expected_img(
            "images/example.svg",
            r#"alt="Relative image" title="Example SVG""#,
        ),
    );
    assert_contains(
        &rendered.html,
        &expected_img("raw%20image.png", r#"alt="Raw image" title="Raw""#),
    );
    assert!(!rendered.html.contains(r#"<a href="./images/example.svg""#));
}

#[test]
fn preserves_markdown_image_alt_and_title_after_url_resolution() {
    let markdown = r#"![Leaf logo](images/logo.svg "Leaf logo title")"#;
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(
        &rendered.html,
        &expected_img(
            "images/logo.svg",
            r#"alt="Leaf logo" title="Leaf logo title""#,
        ),
    );
}

#[test]
fn renders_linked_github_badges_as_images() {
    let markdown = r#"[![Checkup](https://github.com/ryanallen/grid/actions/workflows/checkup.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/checkup.yml)
[![Tests](https://github.com/ryanallen/grid/actions/workflows/tests.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/tests.yml)
[![Lint](https://github.com/ryanallen/grid/actions/workflows/lint.yml/badge.svg?branch=main)](https://github.com/ryanallen/grid/actions/workflows/lint.yml)
[![QEMU Smoke](https://github.com/ryanallen/grid/actions/workflows/qemu-smoke.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/qemu-smoke.yml)
[![Shields Tests](https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests)](https://github.com/ryanallen/grid/actions/workflows/tests.yml)"#;
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    for (label, workflow, badge_url) in [
            (
                "Checkup",
                "checkup.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/checkup.yml?label=Checkup",
            ),
            (
                "Tests",
                "tests.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests",
            ),
            (
                "Lint",
                "lint.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/lint.yml?label=Lint",
            ),
            (
                "QEMU Smoke",
                "qemu-smoke.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/qemu-smoke.yml?label=QEMU+Smoke",
            ),
            (
                "Shields Tests",
                "tests.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests",
            ),
        ] {
            assert_contains(
                &rendered.html,
                &format!(
                    r#"<a href="https://github.com/ryanallen/grid/actions/workflows/{workflow}" rel="noopener noreferrer"><img src="{badge_url}" alt="{label}" title="{label}"></a>"#
                ),
            );
        }

    assert!(!rendered
        .html
        .contains(r#"/actions/workflows/checkup.yml/badge.svg"#));
}

#[test]
fn keeps_safe_absolute_markdown_image_urls() {
    let source_path = fixture_source_path("project/README.md");
    let local_image_path = absolute_path_destination_for_fixture("project/assets/logo.svg");
    let local_file_url = file_url_for_fixture("project/assets/logo.svg");
    let markdown = format!(
        r#"![Remote](https://example.com/assets/logo.svg)
![Local]({local_file_url})
![Absolute path]({local_image_path})"#
    );

    let rendered = render_markdown_document(&markdown, &source_path);

    assert_contains(
        &rendered.html,
        r#"<img src="https://example.com/assets/logo.svg" alt="Remote" title="Remote">"#,
    );
    assert_contains(
        &rendered.html,
        &expected_img("assets/logo.svg", r#"alt="Local" title="Local""#),
    );
    assert_contains(
        &rendered.html,
        &expected_img(
            "assets/logo.svg",
            r#"alt="Absolute path" title="Absolute path""#,
        ),
    );
}

#[test]
fn sanitizes_unsafe_markdown_image_urls() {
    let markdown = r#"![Script](javascript:alert(1))
![Data](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)
![Vbscript](vbscript:msgbox(1))"#;
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert!(!rendered.html.contains("javascript:"));
    assert!(!rendered.html.contains("data:"));
    assert!(!rendered.html.contains("vbscript:"));
    assert_contains(&rendered.html, r#"<img alt="Script" title="Script">"#);
    assert_contains(&rendered.html, r#"<img alt="Data" title="Data">"#);
    assert_contains(&rendered.html, r#"<img alt="Vbscript" title="Vbscript">"#);
}

#[test]
fn resolves_safe_raw_html_image_sources_against_source_directory() {
    let markdown = r#"<p align="center">
<img src="images/logo.png" alt="Leaf logo" title="Leaf" width="96">
<img src=assets/badge.svg alt="Local badge">
</p>"#;
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(
        &rendered.html,
        &expected_img("images/logo.png", r#"alt="Leaf logo" title="Leaf""#),
    );
    assert_contains(
        &rendered.html,
        &expected_img("assets/badge.svg", r#"alt="Local badge""#),
    );
}

#[test]
fn preserves_safe_raw_html_image_assets_after_sanitization() {
    let source_path = fixture_source_path("project/README.md");
    let local_file_url = file_url_for_fixture("project/assets/logo.svg");
    let markdown = format!(r#"<img src="{local_file_url}" alt="Leaf logo" title="Logo">"#);

    let rendered = render_markdown_document(&markdown, &source_path);

    assert_contains(
        &rendered.html,
        &expected_img("assets/logo.svg", r#"alt="Leaf logo" title="Logo""#),
    );
}

#[test]
fn local_image_protocol_serves_rendered_markdown_image_bytes() {
    let dir = scratch_dir("local-image");
    let image_dir = dir.join("nested");
    let markdown_path = dir.join("README.md");
    let image_path = image_dir.join("space image.png");
    let png = tiny_png_bytes();

    fs::create_dir_all(&image_dir).expect("test image directory is created");
    fs::write(&image_path, png).expect("test png is written");

    assert_eq!(
        resolve_image_destination(
            "nested/space%20image.png",
            &markdown_path,
            &DesktopHost::default()
        ),
        Some(local_img("nested/space%20image.png"))
    );
    let rendered = render_markdown_document(
        "![Space image](nested/space%20image.png \"Local\")",
        &markdown_path,
    );
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let response =
        local_image_protocol_response(&local_img("nested/space%20image.png"), Some(&source_dir));

    fs::remove_dir_all(&dir).expect("test image directory is removed");

    assert_contains(
        &rendered.html,
        &expected_img(
            "nested/space%20image.png",
            r#"alt="Space image" title="Local" width="1" height="1""#,
        ),
    );
    assert_eq!(response.status, 200);
    assert_eq!(response.content_type, "image/png");
    assert_eq!(response.body, png);
}

#[test]
fn local_image_protocol_serves_raw_html_svg_bytes() {
    let dir = scratch_dir("local-svg");
    let markdown_path = dir.join("README.md");
    let svg_path = dir.join("logo.svg");
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="green"/></svg>"#;

    fs::write(&svg_path, svg).expect("test svg is written");

    let rendered = render_markdown_document(r#"<img src="logo.svg" alt="Logo">"#, &markdown_path);
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let response = local_image_protocol_response(&local_img("logo.svg"), Some(&source_dir));

    fs::remove_dir_all(&dir).expect("test svg directory is removed");

    assert_contains(
        &rendered.html,
        &expected_img("logo.svg", r#"alt="Logo" width="2" height="2""#),
    );
    assert_eq!(response.status, 200);
    assert_eq!(response.content_type, "image/svg+xml");
    assert_eq!(response.body, svg);
}

#[test]
fn local_image_protocol_serves_requested_markdown_and_html_image_paths() {
    let root = scratch_dir("requested-images");
    let docs = root.join("docs");
    let images = docs.join("imgs");
    let shared = root.join("shared");
    let markdown_path = docs.join("current.md");
    let png = tiny_png_bytes();

    fs::create_dir_all(&images).expect("test image directory is created");
    fs::create_dir_all(&shared).expect("test shared directory is created");
    fs::write(images.join("pic.png"), png).expect("test png is written");
    fs::write(images.join("pic one.png"), png).expect("test spaced png is written");
    fs::write(shared.join("pic.png"), png).expect("test parent png is written");

    let markdown = r#"![alt](imgs/pic.png)
![alt](./imgs/pic.png)
![alt](../shared/pic.png)
![alt](imgs/pic%20one.png)
<img src="imgs/pic.png" alt="alt">
<img src="./imgs/pic.png">
![Remote](https://example.com/pic.png)"#;
    let rendered = render_markdown_document(markdown, &markdown_path);
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");

    for expected in [
        expected_img(
            "imgs/pic.png",
            r#"alt="alt" title="alt" width="1" height="1""#,
        ),
        expected_img(
            "__leaf_parent__/shared/pic.png",
            r#"alt="alt" title="alt" width="1" height="1""#,
        ),
        expected_img(
            "imgs/pic%20one.png",
            r#"alt="alt" title="alt" width="1" height="1""#,
        ),
    ] {
        assert_contains(&rendered.html, &expected);
    }
    assert_contains(
        &rendered.html,
        &format!(
            r#"<img src="{}" width="1" height="1">"#,
            local_img("imgs/pic.png")
        ),
    );
    assert_contains(
        &rendered.html,
        r#"<img src="https://example.com/pic.png" alt="Remote" title="Remote">"#,
    );

    for path in [
        "imgs/pic.png",
        "imgs/pic%20one.png",
        "__leaf_parent__/shared/pic.png",
    ] {
        let response = local_image_protocol_response(&local_img(path), Some(&source_dir));
        assert_eq!(response.status, 200, "expected {path} to load");
        assert_eq!(response.content_type, "image/png");
        assert_eq!(response.body, png);
    }

    fs::remove_dir_all(&root).expect("test image tree is removed");
}

#[test]
fn local_image_protocol_serves_nested_document_image_paths() {
    let root = scratch_dir("nested-images");
    let nested = root.join("docs").join("nested");
    let nested_images = nested.join("imgs");
    let shared = root.join("docs").join("shared");
    let markdown_path = nested.join("current.md");
    let png = tiny_png_bytes();

    fs::create_dir_all(&nested_images).expect("test nested image directory is created");
    fs::create_dir_all(&shared).expect("test shared image directory is created");
    fs::write(nested_images.join("pic.png"), png).expect("nested png is written");
    fs::write(shared.join("pic.png"), png).expect("shared png is written");

    let rendered = render_markdown_document(
        "![Nested](imgs/pic.png)\n![Shared](../shared/pic.png)",
        &markdown_path,
    );
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");

    assert_contains(
        &rendered.html,
        &expected_img(
            "imgs/pic.png",
            r#"alt="Nested" title="Nested" width="1" height="1""#,
        ),
    );
    assert_contains(
        &rendered.html,
        &expected_img(
            "__leaf_parent__/shared/pic.png",
            r#"alt="Shared" title="Shared" width="1" height="1""#,
        ),
    );

    for path in ["imgs/pic.png", "__leaf_parent__/shared/pic.png"] {
        let response = local_image_protocol_response(&local_img(path), Some(&source_dir));
        assert_eq!(response.status, 200, "expected nested {path} to load");
        assert_eq!(response.body, png);
    }

    fs::remove_dir_all(&root).expect("test nested image tree is removed");
}

#[test]
fn local_image_protocol_loads_any_depth_above_the_document_and_reports_missing_images() {
    let root = scratch_dir("local-image-scope");
    let nested = root.join("docs").join("01-features");
    let markdown_path = nested.join("themes.md");
    let png = tiny_png_bytes();

    fs::create_dir_all(root.join("imgs")).expect("test image directory is created");
    fs::create_dir_all(&nested).expect("test docs directory is created");
    fs::write(root.join("imgs").join("pic.png"), png).expect("test image is written");

    // Two levels up, as the shipped docs reference their screenshots.
    let rendered = render_markdown_document(
        "![Up two](../../imgs/pic.png)\n![Missing](missing.png)",
        &markdown_path,
    );
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let missing = local_image_protocol_response(&local_img("missing.png"), Some(&source_dir));
    let up_two = local_image_protocol_response(
        &local_img("__leaf_parent__/__leaf_parent__/imgs/pic.png"),
        Some(&source_dir),
    );

    fs::remove_dir_all(&root).expect("test docs directory is removed");

    assert_contains(
        &rendered.html,
        &expected_img(
            "__leaf_parent__/__leaf_parent__/imgs/pic.png",
            r#"alt="Up two" title="Up two" width="1" height="1""#,
        ),
    );
    assert_contains(
        &rendered.html,
        &expected_img("missing.png", r#"alt="Missing" title="Missing""#),
    );
    assert_eq!(missing.status, 404);
    assert_eq!(up_two.status, 200, "an image two levels up must load");
    assert_eq!(up_two.body, png);
}

#[test]
fn local_image_protocol_loads_absolute_paths_outside_the_document_tree() {
    let root = scratch_dir("local-image-absolute");
    let docs = root.join("docs");
    let elsewhere = root.join("elsewhere");
    let markdown_path = docs.join("README.md");
    let image_path = elsewhere.join("pic.png");
    let png = tiny_png_bytes();

    fs::create_dir_all(&docs).expect("test docs directory is created");
    fs::create_dir_all(&elsewhere).expect("test image directory is created");
    fs::write(&image_path, png).expect("test image is written");

    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let url = resolve_image_destination(
        &image_path.to_string_lossy(),
        &markdown_path,
        &DesktopHost::default(),
    )
    .expect("an absolute path outside the document tree resolves to a URL");
    let response = local_image_protocol_response(&url, Some(&source_dir));

    fs::remove_dir_all(&root).expect("test directories are removed");

    assert!(
        url.contains("__leaf_absolute__"),
        "expected an absolute-path URL, got {url}"
    );
    assert_eq!(response.status, 200, "an absolute path must load");
    assert_eq!(response.body, png);
}

#[test]
fn an_inserted_picture_is_addressed_from_the_notes_folder() {
    let root = scratch_dir("inserted-picture-destination");
    let note = root.join("notes").join("note.md");

    assert_eq!(
        markdown_image_insert_destination(&root.join("notes").join("pic.png"), &note),
        "pic.png"
    );
    assert_eq!(
        markdown_image_insert_destination(&root.join("notes").join("imgs").join("pic.png"), &note),
        "imgs/pic.png"
    );
    let above = root.join("pic.png");
    assert_eq!(
        markdown_image_insert_destination(&above, &note),
        above.display().to_string()
    );
}

/// A published site's page sits at the top and its documents sit under a folder, so every picture a document names is reached through that folder joined with the document's own — at any depth, through a raw HTML tag as well as a Markdown one, and folding a `..` the way a browser folds one so a tree keeping one shared pictures folder above its documents still finds them. Nothing may address a file outside the folder the site was built from: a climb that would go above it stops there, and so does an address written from a root.
#[test]
fn a_served_site_asks_for_a_picture_beside_the_document_that_names_it() {
    let host = crate::tests::web_core::ServedDocumentsHost;
    let asked_for = |source: &str, path: &str| {
        render_markdown_document_with_host(source, Path::new(path), &host).html
    };

    // The document at the top of the site: its own folder is empty, so the picture sits directly under the served folder.
    assert_contains(
        &asked_for("![Shot](imgs/shot.png)", "README.md"),
        "src=\"source/imgs/shot.png\"",
    );
    // And one in a folder of its own, which is the case that was watched asking the top of the site instead.
    assert_contains(
        &asked_for("![Deep](imgs/deep.png)", "notes/deep.md"),
        "src=\"source/notes/imgs/deep.png\"",
    );
    // A raw HTML tag comes out the same way, since both spellings go through one resolver.
    assert_contains(
        &asked_for("<img src=\"imgs/raw.png\" alt=\"Raw\">", "notes/deep.md"),
        "src=\"source/notes/imgs/raw.png\"",
    );
    // A tree keeping one shared pictures folder above its documents, which is what the plan folder next door is.
    assert_contains(
        &asked_for("![Up](../../imgs/up.png)", "fixes/plugins/one.md"),
        "src=\"source/imgs/up.png\"",
    );
    // A diagram box's picture is the third spelling of the same thing.
    assert_contains(
        &asked_for(
            "```mermaid\nflowchart TD\n  A@{ img: \"imgs/box.png\" }\n```",
            "notes/deep.md",
        ),
        "source/notes/imgs/box.png",
    );

    // Nothing outside the folder the site was built from is addressable: a climb above it stops there, and an address written from a root is read as one under it.
    for (source, expected) in [
        (
            "![Out](../../../../elsewhere/pic.png)",
            "src=\"source/elsewhere/pic.png\"",
        ),
        ("![Rooted](/imgs/root.png)", "src=\"source/imgs/root.png\""),
    ] {
        let html = asked_for(source, "notes/deep.md");
        assert_contains(&html, expected);
        assert!(
            !html.contains("src=\"/"),
            "a picture was addressed above the served folder:\n{html}"
        );
    }

    // An address the browser can fetch for itself is left exactly as it was written.
    assert_contains(
        &asked_for("![Remote](https://example.com/pic.png)", "notes/deep.md"),
        "src=\"https://example.com/pic.png\"",
    );
}

/// Who may read one of these answers back — the one thing standing between a reader converting a picture and a script that got into the page reading every file on the disk.
///
/// The page is served with `with_html`, so its origin is opaque and every custom-scheme answer is cross-origin to it: without a header the page cannot read one pixel of a picture it is showing, which is why converting a JPEG to a PNG was impossible at all. This responder hands back whatever file the address names with no test that it is a picture, so the header is sent for the eleven kinds the reading view draws and left off everything else.
#[test]
fn only_a_picture_may_be_read_back_by_the_page() {
    let dir = scratch_dir("image-allow-origin");
    let markdown_path = dir.join("README.md");
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");

    // Every kind the reading view draws, each answered with the header that lets the page read it.
    for ending in [
        "apng", "avif", "bmp", "gif", "ico", "jfif", "jpeg", "jpg", "png", "svg", "webp",
    ] {
        let name = format!("shot.{ending}");
        fs::write(dir.join(&name), b"pretend picture").expect("the picture is written");
        let answer = local_image_protocol_response(&local_img(&name), Some(&source_dir));
        assert_eq!(answer.status, 200, "{name} was not served at all");
        assert_eq!(
            answer.allow_origin, "*",
            "{name} is a picture the reading view draws and the page still cannot read it back"
        );
    }

    // Everything else, which this responder will happily read off the disk and must never hand to the page.
    for name in [
        "secrets.env",
        "id_rsa",
        "notes.md",
        "vault.db",
        "archive.zip",
        "noending",
    ] {
        fs::write(dir.join(name), b"not a picture").expect("the file is written");
        let answer = local_image_protocol_response(&local_img(name), Some(&source_dir));
        assert_eq!(answer.status, 200, "{name} was not served at all");
        assert_eq!(
            answer.allow_origin, "",
            "{name} is not a picture and the page was told it may read its bytes"
        );
    }

    // And nothing that failed says anything either: a 404 or a refusal is not a picture.
    let missing = local_image_protocol_response(&local_img("gone.png"), Some(&source_dir));
    assert_eq!(missing.status, 404);
    assert_eq!(
        missing.allow_origin, "",
        "an answer with no picture behind it still invited the page to read it"
    );

    fs::remove_dir_all(&dir).expect("the folder is removed");
}
