//! Email rendering: headers, bodies, inline images, attachments.

use super::*;

/// A Gmail-shaped message: related wrapping alternative, base64 HTML body, an inline image by content id, and a real attachment.
fn multipart_fixture() -> String {
    // The HTML body, base64-coded the way mail on the wire arrives. It carries a script the sanitizer must eat and a cid image the renderer must embed.
    let html =
        "<p>Hi there <script>alert(1)</script><img src=\"cid:logo@example\" alt=\"Logo\"></p>";
    let html_b64 = eml_base64(html.as_bytes());
    format!(
        concat!(
            "From: Ada Lovelace <ada@example.com>\n",
            "To: Reader One <reader@example.com>, second@example.com\n",
            "Cc: Watcher <watch@example.com>\n",
            "Subject: =?utf-8?B?TcOpbW8gZMOpamV1bmVy?=\n",
            "Date: Wed, 29 Jul 2026 23:21:20 +0000\n",
            "MIME-Version: 1.0\n",
            "Content-Type: multipart/related; boundary=\"rel\"\n",
            "\n",
            "--rel\n",
            "Content-Type: multipart/alternative; boundary=\"alt\"\n",
            "\n",
            "--alt\n",
            "Content-Type: text/plain; charset=\"utf-8\"\n",
            "\n",
            "Plain fallback\n",
            "--alt\n",
            "Content-Type: text/html; charset=\"utf-8\"\n",
            "Content-Transfer-Encoding: base64\n",
            "\n",
            "{html}\n",
            "--alt--\n",
            "--rel\n",
            "Content-Type: image/png; name=\"logo.png\"\n",
            "Content-ID: <logo@example>\n",
            "Content-Disposition: inline; filename=\"logo.png\"\n",
            "Content-Transfer-Encoding: base64\n",
            "\n",
            "iVBORw0KGgo=\n",
            "--rel\n",
            "Content-Type: application/pdf; name=\"notes.pdf\"\n",
            "Content-Disposition: attachment; filename=\"notes.pdf\"\n",
            "Content-Transfer-Encoding: base64\n",
            "\n",
            "JVBERi0xLjQ=\n",
            "--rel--\n",
        ),
        html = html_b64
    )
}

/// Standard base64 for fixtures, mirroring what a mail client writes.
fn eml_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let group = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let value = u32::from_be_bytes([0, group[0], group[1], group[2]]);
        for index in 0..4 {
            out.push(if index < chunk.len() + 1 {
                ALPHABET[((value >> (18 - index * 6)) & 63) as usize] as char
            } else {
                '='
            });
        }
    }
    out
}

#[test]
fn eml_extensions_route_to_the_email_renderer() {
    for name in ["mail.eml", "mail.EML", "page.mht", "page.mhtml"] {
        assert_eq!(
            DocumentFormat::from_path(Path::new(name)),
            DocumentFormat::Eml,
            "{name}"
        );
        assert!(is_supported_document_path(Path::new(name)), "{name}");
    }
}

#[test]
fn subject_titles_the_message_with_encoded_words_decoded() {
    let (title, html, _) = render_eml_document(&multipart_fixture(), None);
    assert_eq!(title.as_deref(), Some("Mémo déjeuner"));
    assert_contains(&html, "<h1 id=\"mémo-déjeuner\">Mémo déjeuner</h1>");
}

#[test]
fn headers_render_as_fields_with_mailto_links() {
    let (_, html, _) = render_eml_document(&multipart_fixture(), None);
    assert_contains(&html, "<dl class=\"data-fields email-headers\">");
    assert_contains(
        &html,
        ">Ada Lovelace &lt;<a href=\"mailto:ada@example.com\">ada@example.com</a>&gt;</dd>",
    );
    // A bare address links without a name; list members join with commas.
    assert_contains(&html, ", <a href=\"mailto:second@example.com\">");
    assert_contains(&html, "<dt>Cc</dt>");
    assert_contains(&html, ">Wed, 29 Jul 2026 23:21:20 +0000</dd>");
}

#[test]
fn html_body_is_sanitized() {
    let (_, html, _) = render_eml_document(&multipart_fixture(), None);
    assert_contains(&html, "Hi there");
    assert!(!html.contains("<script"), "script must not survive: {html}");
    assert!(
        !html.contains("alert(1)"),
        "script text must not survive: {html}"
    );
}

#[test]
fn cid_images_embed_as_data_urls() {
    let (_, html, _) = render_eml_document(&multipart_fixture(), None);
    assert_contains(&html, "src=\"data:image/png;base64,iVBORw0KGgo=\"");
    assert!(
        !html.contains("cid:logo"),
        "the cid should be resolved: {html}"
    );
}

#[test]
fn attachments_list_without_the_embedded_image() {
    let (_, html, _) = render_eml_document(&multipart_fixture(), None);
    assert_contains(&html, "<h2 id=\"attachments\">Attachments</h2>");
    assert_contains(&html, "notes.pdf");
    assert_contains(&html, "application/pdf");
    // The logo went inline; listing it again would double-count it.
    assert!(!html.contains("logo.png"), "{html}");
}

#[test]
fn plain_text_messages_render_as_linkified_paragraphs() {
    let message = concat!(
        "From: a@example.com\n",
        "Subject: Notes\n",
        "Content-Type: text/plain; charset=\"utf-8\"\n",
        "\n",
        "See https://example.com/page for more.\n",
        "\n",
        "Second paragraph with <angle brackets>.\n",
    );
    let (title, html, _) = render_eml_document(message, None);
    assert_eq!(title.as_deref(), Some("Notes"));
    assert_contains(
        &html,
        ">See <a href=\"https://example.com/page\">https://example.com/page</a> for more.</p>",
    );
    assert_contains(&html, ">Second paragraph with &lt;angle brackets&gt;.</p>");
}

#[test]
fn unknown_cids_stay_unresolved_and_inert() {
    let html_body = "<p><img src=\"cid:missing@nowhere\"></p>";
    let message = format!(
        concat!(
            "From: a@example.com\n",
            "Subject: Ghost\n",
            "Content-Type: text/html; charset=\"utf-8\"\n",
            "\n",
            "{body}\n",
        ),
        body = html_body
    );
    let (_, html, _) = render_eml_document(&message, None);
    // Left as cid:, which the page's CSP refuses to load; never a data: URL.
    assert_contains(&html, "cid:missing@nowhere");
    assert!(!html.contains("data:"), "{html}");
}

#[test]
fn the_file_name_titles_a_message_with_no_subject() {
    let message = "From: a@example.com\nContent-Type: text/plain\n\nBody.\n";
    let (title, html, _) = render_eml_document(message, Some("Saved message"));
    assert_eq!(title, None);
    // Marked as the file's name rather than the message's own words, which is what the app offers a rename on.
    assert_contains(
        &html,
        "<h1 id=\"saved-message\" data-borrowed-title>Saved message</h1>",
    );
}

#[test]
fn a_subject_of_its_own_heads_the_message_unmarked() {
    let message = "From: a@example.com\nSubject: Lunch\nContent-Type: text/plain\n\nBody.\n";
    let (title, html, _) = render_eml_document(message, Some("Saved message"));
    assert_eq!(title.as_deref(), Some("Lunch"));
    assert_contains(&html, ">Lunch</h1>");
    // The words are the message's, so pressing the heading edits the Subject line rather than renaming the file.
    assert!(!html.contains("data-borrowed-title"), "{html}");
}

#[test]
fn an_eml_document_carries_its_source_and_only_what_it_proved() {
    let source = multipart_fixture();
    let document = opened_document_from_source(&source, Path::new("mail.eml"));
    assert_eq!(document.format, DocumentFormat::Eml);
    assert_eq!(document.source, source);
    assert!(document.tasks.is_empty());
    assert_eq!(document.title, "Mémo déjeuner");
    // Its body is base64 and its subject an encoded word, so neither is written in the file as the page draws it. The plain header lines are, and they are all it proved.
    assert_eq!(
        stamped_slices(&source),
        vec![
            ("email_header", "Ada Lovelace <ada@example.com>".to_string()),
            (
                "email_header",
                "Reader One <reader@example.com>, second@example.com".to_string()
            ),
            ("email_header", "Watcher <watch@example.com>".to_string()),
            (
                "email_header",
                "Wed, 29 Jul 2026 23:21:20 +0000".to_string()
            ),
        ]
    );
}

#[test]
fn a_message_that_proves_nothing_stamps_nothing() {
    // Nothing to open anywhere on the page: the subject is an encoded word, the body is base64, and there is no header card at all. This is the message the padlock leaves the tray on.
    let coded = eml_base64("Packed words.\r\n".as_bytes());
    let source = format!(
        "Subject: =?utf-8?B?TcOpbW8=?=\r\nContent-Type: text/plain; charset=\"utf-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{coded}\r\n"
    );
    let (_, html, blocks) = render_eml_document(&source, None);
    assert_contains(&html, "Packed words.");
    assert!(blocks.is_empty());
}

/// A message the way one is really written down: `\r\n` throughout, nothing coded.
fn plain_text_fixture() -> String {
    "From: a@example.com\r\nSubject: Plain\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\nFirst paragraph.\r\n\r\nSecond one, over\r\ntwo lines.\r\n".to_string()
}

/// Every range the render proved, cut back out of the message it was measured against.
fn stamped_slices(source: &str) -> Vec<(&'static str, String)> {
    let (_, _, blocks) = render_eml_document(source, None);
    blocks
        .iter()
        .map(|block| (block.kind, source[block.start..block.end].to_string()))
        .collect()
}

/// The same, kept to one kind of block.
fn stamped_slices_of(source: &str, kind: &str) -> Vec<String> {
    stamped_slices(source)
        .into_iter()
        .filter(|(one, _)| *one == kind)
        .map(|(_, slice)| slice)
        .collect()
}

#[test]
fn a_plain_text_body_stamps_one_range_per_paragraph() {
    let source = plain_text_fixture();
    let (_, html, blocks) = render_eml_document(&source, None);

    assert_eq!(
        stamped_slices_of(&source, "email_paragraph"),
        vec![
            "First paragraph.".to_string(),
            "Second one, over\r\ntwo lines.".to_string(),
        ]
    );
    // Each range reaches the page as the attributes the reading view turns into a source editor.
    for block in &blocks {
        assert_contains(
            &html,
            &format!(
                "data-src-start=\"{}\" data-src-end=\"{}\"",
                block.start, block.end
            ),
        );
    }
    // The words themselves are unchanged by carrying a range, and the line inside a paragraph still breaks.
    assert_contains(&html, "First paragraph.</p>");
    assert_contains(&html, "Second one, over<br>two lines.</p>");
    // The Markdown WYSIWYG path is not open to these; they edit their own source.
    assert!(blocks.iter().all(|block| !block.editable));
}

#[test]
fn a_run_of_blank_lines_is_one_break_and_stamps_nothing_of_its_own() {
    let source =
        "From: a@example.com\r\nContent-Type: text/plain\r\n\r\n\r\nOne.\r\n\r\n\r\n\r\nTwo.\r\n\r\n"
            .to_string();
    assert_eq!(
        stamped_slices_of(&source, "email_paragraph"),
        vec!["One.".to_string(), "Two.".to_string()]
    );
}

#[test]
fn a_packed_body_stamps_nothing() {
    let quoted = "From: a@example.com\r\nContent-Type: text/plain; charset=\"utf-8\"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCaf=C3=A9 time.\r\n";
    let (_, html, _) = render_eml_document(quoted, None);
    assert_contains(&html, "Café time.");
    assert!(stamped_slices_of(quoted, "email_paragraph").is_empty());

    let coded = eml_base64("Base64 words.\r\n".as_bytes());
    let base64 = format!(
        "From: a@example.com\r\nContent-Type: text/plain; charset=\"utf-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{coded}\r\n"
    );
    let (_, html, _) = render_eml_document(&base64, None);
    assert_contains(&html, "Base64 words.");
    assert!(stamped_slices_of(&base64, "email_paragraph").is_empty());
}

#[test]
fn a_body_the_reader_had_to_transcode_stamps_nothing() {
    // The bytes are UTF-8 but the message calls them Latin-1, so what the reader shows is not what the file says.
    let source =
        "From: a@example.com\r\nContent-Type: text/plain; charset=\"iso-8859-1\"\r\n\r\nCafé time.\r\n";
    let (_, html, _) = render_eml_document(source, None);
    assert_contains(&html, "CafÃ©");
    assert!(stamped_slices_of(source, "email_paragraph").is_empty());
}

#[test]
fn plain_single_line_headers_stamp_over_their_own_value() {
    let source = "From: Ada <ada@example.com>\r\nTo: grace@example.com\r\nSubject: A plain subject\r\nDate: Mon, 3 Aug 2026 09:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nBody.\r\n";
    let (_, html, blocks) = render_eml_document(source, None);

    // The leading space and the line break stay outside every one of them.
    assert_eq!(
        stamped_slices_of(source, "email_header"),
        vec![
            "A plain subject".to_string(),
            "Ada <ada@example.com>".to_string(),
            "grace@example.com".to_string(),
            "Mon, 3 Aug 2026 09:00:00 +0000".to_string(),
        ]
    );
    // The subject's range rides on the heading, so the title opens where it is read.
    let subject = &blocks[0];
    assert_contains(
        &html,
        &format!(
            "<h1 id=\"a-plain-subject\" data-block-id=\"0\" data-src-start=\"{}\" data-src-end=\"{}\"",
            subject.start, subject.end
        ),
    );
    // Every other one rides on the value of its row, not on the label beside it.
    assert_contains(&html, "<dt>From</dt><dd data-block-id=\"1\"");
}

#[test]
fn a_folded_header_and_an_encoded_word_are_drawn_and_not_stamped() {
    let source = "From: a@example.com\r\nSubject: =?utf-8?B?TcOpbW8=?=\r\nTo: One <one@example.com>,\r\n Two <two@example.com>\r\nContent-Type: text/plain\r\n\r\nBody.\r\n";
    let (title, html, _) = render_eml_document(source, None);

    // Both are still drawn, decoded and joined the way a reader wants them.
    assert_eq!(title.as_deref(), Some("Mémo"));
    assert_contains(&html, "one@example.com");
    assert_contains(&html, "two@example.com");
    // Only the one plain header line proved anything.
    assert_eq!(
        stamped_slices_of(source, "email_header"),
        vec!["a@example.com".to_string()]
    );
}

#[test]
fn typing_a_new_subject_leaves_every_other_header_alone() {
    let source =
        "From: a@example.com\r\nSubject: Old subject\r\nContent-Type: text/plain\r\n\r\nBody.\r\n";
    let (_, _, blocks) = render_eml_document(source, None);
    let subject = &blocks[0];

    let mut edit = EditableDocument::new(
        PathBuf::from("mail.eml"),
        SourceText::utf8(source.to_string()),
    );
    assert!(edit.replace_range(subject.start, subject.end, "New subject"));
    assert_eq!(
        edit.text(),
        "From: a@example.com\r\nSubject: New subject\r\nContent-Type: text/plain\r\n\r\nBody.\r\n"
    );
}

/// A two-part message whose HTML half is written plainly, wrapped so the part has a boundary after it. `encoding` is a whole header line, or nothing at all.
fn html_body_fixture(encoding: &str, body: &str) -> String {
    format!(
        "From: a@example.com\r\nSubject: Marked up\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"alt\"\r\n\r\n--alt\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\nPlain half.\r\n--alt\r\nContent-Type: text/html; charset=\"utf-8\"\r\n{encoding}\r\n{body}\r\n--alt--\r\n"
    )
}

#[test]
fn an_unencoded_html_body_stamps_its_section_and_nothing_inside_it() {
    let source = html_body_fixture("", "<p>Marked <b>up</b>.</p>");
    let (_, html, _) = render_eml_document(&source, None);

    assert_eq!(
        stamped_slices_of(&source, "email_body"),
        vec!["<p>Marked <b>up</b>.</p>".to_string()]
    );
    // The range rides on the section around the body, and the drawn markup inside carries none of its own.
    assert_contains(&html, "<section class=\"email-body\" data-block-id=");
    let (_, after_tag) = html
        .split_once("<section class=\"email-body\"")
        .and_then(|(_, rest)| rest.split_once('>'))
        .expect("a body section to look inside");
    let inside = after_tag
        .split_once("</section>")
        .map(|(body, _)| body)
        .unwrap_or(after_tag);
    assert!(!inside.contains("data-src-start"), "{inside}");

    // Packed, the same body is drawn and not stamped.
    let coded = eml_base64("<p>Marked <b>up</b>.</p>".as_bytes());
    let packed = html_body_fixture("Content-Transfer-Encoding: base64\r\n", &coded);
    let (_, html, _) = render_eml_document(&packed, None);
    assert_contains(&html, "Marked <b>up</b>.");
    assert!(stamped_slices_of(&packed, "email_body").is_empty());
}

#[test]
fn an_edit_to_the_body_section_leaves_the_headers_and_the_boundaries_alone() {
    let source = html_body_fixture("", "<p>Marked <b>up</b>.</p>");
    let (_, _, blocks) = render_eml_document(&source, None);
    let body = blocks
        .iter()
        .find(|block| block.kind == "email_body")
        .expect("the html body proved its range");

    let mut edit =
        EditableDocument::new(PathBuf::from("mail.eml"), SourceText::utf8(source.clone()));
    // The line break before the boundary is outside the range, so the message's shape survives the edit.
    assert!(edit.replace_range(body.start, body.end, "<p>Rewritten.</p>"));
    assert_eq!(
        edit.text(),
        source.replace("<p>Marked <b>up</b>.</p>", "<p>Rewritten.</p>")
    );
}

#[test]
fn a_paragraph_over_two_lines_draws_the_message_and_nothing_else() {
    // The break used to carry a newline of its own, which is one character more than the message has — so the page could not write the paragraph back and it fell out to the raw-slice editor.
    let source = plain_text_fixture();
    let (_, html, blocks) = render_eml_document(&source, None);
    let second = blocks
        .iter()
        .filter(|block| block.kind == "email_paragraph")
        .nth(1)
        .expect("the two-line paragraph");

    assert_contains(&html, ">Second one, over<br>two lines.</p>");
    // What the page holds for that block, with the break read as the message's own ending, is the bytes its range cuts.
    let drawn = html
        .split_once(&format!(
            "data-src-end=\"{}\" data-block-kind=\"email_paragraph\">",
            second.end
        ))
        .and_then(|(_, rest)| rest.split_once("</p>"))
        .map(|(inside, _)| inside.replace("<br>", "\r\n"))
        .expect("the paragraph on the page");
    assert_eq!(drawn, source[second.start..second.end]);
}

#[test]
fn splitting_a_paragraph_writes_one_blank_line_and_nothing_else() {
    let source = plain_text_fixture();
    let (_, _, blocks) = render_eml_document(&source, None);
    let first = blocks
        .iter()
        .find(|block| block.kind == "email_paragraph")
        .expect("a paragraph to split");

    // What the page sends when Enter lands after "First": the block's own range, rewritten as its two halves with the message's blank line between them.
    let mut edit =
        EditableDocument::new(PathBuf::from("mail.eml"), SourceText::utf8(source.clone()));
    assert!(edit.replace_range(first.start, first.end, "First\r\n\r\nparagraph."));
    assert_eq!(
        edit.text(),
        "From: a@example.com\r\nSubject: Plain\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\nFirst\r\n\r\nparagraph.\r\n\r\nSecond one, over\r\ntwo lines.\r\n"
    );
    // Read back, the message now draws three paragraphs and each still cuts its own bytes.
    assert_eq!(
        stamped_slices_of(edit.text(), "email_paragraph"),
        vec![
            "First".to_string(),
            "paragraph.".to_string(),
            "Second one, over\r\ntwo lines.".to_string(),
        ]
    );
}

#[test]
fn swapping_two_body_paragraphs_leaves_the_envelope_identical() {
    let source = plain_text_fixture();
    let (_, _, blocks) = render_eml_document(&source, None);
    let ranges: Vec<(usize, usize)> = blocks
        .iter()
        .filter(|block| block.kind == "email_paragraph")
        .map(|block| (block.start, block.end))
        .collect();

    let mut edit =
        EditableDocument::new(PathBuf::from("mail.eml"), SourceText::utf8(source.clone()));
    assert!(edit.move_blocks(&ranges, 1, 0));
    // The blank line between them never moved, and neither did a header.
    assert_eq!(
        edit.text(),
        "From: a@example.com\r\nSubject: Plain\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\nSecond one, over\r\ntwo lines.\r\n\r\nFirst paragraph.\r\n"
    );
}

#[test]
fn typing_over_a_stamped_paragraph_leaves_the_rest_of_the_message_alone() {
    let source = plain_text_fixture();
    let (_, _, blocks) = render_eml_document(&source, None);
    let second = blocks.last().expect("the body proved two ranges");

    let mut edit =
        EditableDocument::new(PathBuf::from("mail.eml"), SourceText::utf8(source.clone()));
    assert!(edit.replace_range(second.start, second.end, "Rewritten."));
    assert_eq!(
        edit.text(),
        "From: a@example.com\r\nSubject: Plain\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\nFirst paragraph.\r\n\r\nRewritten.\r\n"
    );
}
