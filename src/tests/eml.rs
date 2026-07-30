//! Email rendering: headers, bodies, inline images, attachments.

use super::*;

/// A Gmail-shaped message: related wrapping alternative, base64 HTML body,
/// an inline image by content id, and a real attachment.
fn multipart_fixture() -> String {
    // The HTML body, base64-coded the way mail on the wire arrives. It carries
    // a script the sanitizer must eat and a cid image the renderer must embed.
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
        "<dt>From</dt><dd>Ada Lovelace &lt;<a href=\"mailto:ada@example.com\">ada@example.com</a>&gt;</dd>",
    );
    // A bare address links without a name; list members join with commas.
    assert_contains(&html, ", <a href=\"mailto:second@example.com\">");
    assert_contains(&html, "<dt>Cc</dt>");
    assert_contains(
        &html,
        "<dt>Date</dt><dd>Wed, 29 Jul 2026 23:21:20 +0000</dd>",
    );
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
        "<p>See <a href=\"https://example.com/page\">https://example.com/page</a> for more.</p>",
    );
    assert_contains(
        &html,
        "<p>Second paragraph with &lt;angle brackets&gt;.</p>",
    );
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
    assert_contains(&html, "<h1 id=\"saved-message\">Saved message</h1>");
}

#[test]
fn eml_documents_open_with_source_and_no_inline_blocks() {
    let source = multipart_fixture();
    let document = opened_document_from_source(&source, Path::new("mail.eml"));
    assert_eq!(document.format, DocumentFormat::Eml);
    assert_eq!(document.source, source);
    assert!(document.blocks.is_empty());
    assert!(document.tasks.is_empty());
    assert_eq!(document.title, "Mémo déjeuner");
}
