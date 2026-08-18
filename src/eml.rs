//! Email: `.eml` (and `.mht`, the same MIME envelope) rendered for reading.
//!
//! mail-parser undoes the wire format — multipart trees, base64 and quoted-printable, encoded-word headers, per-part charsets. What lands on the page still crosses the same ammonia boundary as Markdown's raw HTML; the one extra grant is the `cid:` scheme, kept only so the pass after sanitizing can swap each reference for a `data:` image built from the message's own parts. Nothing here reaches the network.

use crate::*;
use mail_parser::{Address, Message, MessageParser, MimeHeaders, PartType};

/// The ranges this message proved, and the ids that go with them. One rule decides every stamp: the file has to say the same words the page is drawing, so a packed body is drawn and not stamped, and the code view edits it whole.
struct EmlBlocks {
    blocks: Vec<BlockSpan>,
    next_id: usize,
}

impl EmlBlocks {
    fn new() -> Self {
        Self {
            blocks: Vec::new(),
            next_id: 0,
        }
    }

    /// Record a proved range and return the `data-*` attributes that open it where it is read. An end offset off by a byte corrupts the file, so nothing that was not measured against the source reaches this.
    fn attrs(&mut self, kind: &'static str, start: usize, end: usize) -> String {
        let id = self.next_id;
        self.next_id += 1;
        self.blocks.push(BlockSpan::new(id, kind, start, end));
        format!(
            " data-block-id=\"{id}\" data-src-start=\"{start}\" data-src-end=\"{end}\" data-block-kind=\"{kind}\""
        )
    }
}

/// The body slice of `part` when the file says exactly what the reader decoded from it. One comparison separates a part holding its own words from one that does not, so nothing here reads `Content-Transfer-Encoding` or a charset: a quoted-printable body, a base64 body and a body the declared charset made the reader transcode all fail it.
fn verbatim_part_body<'a>(
    source: &'a str,
    part: &mail_parser::MessagePart,
    decoded: &str,
) -> Option<(usize, &'a str)> {
    let start = part.offset_body as usize;
    let raw = source.get(start..part.offset_end as usize)?;
    (raw == decoded).then_some((start, raw))
}

/// Render a MIME message to `(title, html, blocks)`: subject heading, header fields, the body (HTML preferred, plain text otherwise), then attachments. A part whose words are written in the file as they are drawn carries its own source range and opens where it is read; a packed one is drawn without one, and the code view edits the raw message.
pub(crate) fn render_eml_document(
    source: &str,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    let Some(message) = MessageParser::default().parse(source) else {
        return (
            None,
            "<p><strong>This file could not be read as an email message.</strong></p>".to_string(),
            Vec::new(),
        );
    };

    let title = message.subject().and_then(plain_document_title);
    let mut out = String::new();
    let mut blocks = EmlBlocks::new();

    let heading = title
        .clone()
        .or_else(|| fallback_title.and_then(plain_document_title));
    if let Some(heading) = &heading {
        // Only where the heading is the message's own subject: a file name standing in for a missing one is not a line of the file, and it is marked as the file's instead.
        let attrs = match title
            .as_ref()
            .map(|_| plain_header_span(&message, source, "Subject"))
        {
            Some(Some((start, end))) => blocks.attrs("email_header", start, end),
            Some(None) => String::new(),
            None => BORROWED_TITLE_ATTR.to_string(),
        };
        out.push_str(&format!(
            "<h1 id=\"{}\"{attrs}>{}</h1>\n",
            encode_double_quoted_attribute(&tei_slugify(heading)),
            encode_text(heading)
        ));
    }

    out.push_str(&header_fields_html(&message, source, &mut blocks));

    // Inline images referenced by the HTML body don't repeat as attachments.
    let mut embedded_ids = HashSet::new();

    // A text-only message still lists its part under `html_body` (mail-parser converts on demand), so ask the part what it really is.
    let wrote_html = message
        .html_part(0)
        .is_some_and(|part| matches!(part.body, PartType::Html(_)));

    if wrote_html {
        let body = message.body_html(0).unwrap_or_default();
        let sanitized = sanitize_email_html(&body);
        // The whole body, in one range on the section around it: what a reader types there is markup, and it goes back through the sanitizer above on the next render, the same way the body it replaced did. Nothing inside is stamped, or one click would carry two ranges.
        let attrs = match message
            .html_part(0)
            .and_then(|part| verbatim_part_body(source, part, &body))
        {
            Some((start, raw)) => blocks.attrs("email_body", start, start + raw.len()),
            None => String::new(),
        };
        out.push_str(&format!("<section class=\"email-body\"{attrs}>\n"));
        out.push_str(&embed_cid_images(&sanitized, &message, &mut embedded_ids));
        out.push_str("\n</section>\n");
    } else if let Some(text) = message.body_text(0) {
        // The words themselves, or a decoded copy of them: the first opens where it is read, the second is drawn and edited in the source view.
        let verbatim = message
            .text_part(0)
            .and_then(|part| verbatim_part_body(source, part, &text));
        out.push_str("<section class=\"email-body\">\n");
        match verbatim {
            Some((offset, raw)) => {
                out.push_str(&plain_text_body_html(raw, Some((offset, &mut blocks))))
            }
            None => out.push_str(&plain_text_body_html(&text, None)),
        }
        out.push_str("</section>\n");
    }

    out.push_str(&attachments_html(&message, &embedded_ids));

    (title, out, blocks.blocks)
}

/// The header card: who wrote, who received, when. Fields the message lacks leave no row, and a row whose value is written plainly in the file opens where it is read.
fn header_fields_html(message: &Message, source: &str, blocks: &mut EmlBlocks) -> String {
    let mut fields: Vec<(&'static str, String)> = Vec::new();
    if let Some(from) = message.from() {
        fields.push(("From", address_html(from)));
    }
    if let Some(to) = message.to() {
        fields.push(("To", address_html(to)));
    }
    if let Some(cc) = message.cc() {
        fields.push(("Cc", address_html(cc)));
    }
    if let Some(date) = message.date() {
        fields.push(("Date", encode_text(&date.to_rfc822()).into_owned()));
    }

    let mut rows = String::new();
    for (label, value) in fields {
        if value.is_empty() {
            continue;
        }
        // The row is drawn from the parsed value — a name beside a mailto link, a date spelled out — and opens on the line the file actually holds, which is the same trade every XML block already makes.
        let attrs = match plain_header_span(message, source, label) {
            Some((start, end)) => blocks.attrs("email_header", start, end),
            None => String::new(),
        };
        rows.push_str(&format!("<dt>{label}</dt><dd{attrs}>{value}</dd>\n"));
    }

    if rows.is_empty() {
        return String::new();
    }
    format!("<dl class=\"data-fields email-headers\">\n{rows}</dl>\n")
}

/// The byte range of `name`'s value where the file says it plainly: one line, no folding, no encoded word — so what opens is what is written down. The leading space and the trailing line break stay outside the range.
fn plain_header_span(message: &Message, source: &str, name: &str) -> Option<(usize, usize)> {
    let header = message
        .headers()
        .iter()
        .find(|header| header.name.as_str().eq_ignore_ascii_case(name))?;
    let start = header.offset_start as usize;
    let raw = source.get(start..header.offset_end as usize)?;
    // An encoded word is packed, and a value carrying a line ending inside it is folded over more than one line of the file.
    let value = raw.trim_end_matches(['\r', '\n']);
    if value.contains("=?") || value.contains('\n') || value.contains('\r') {
        return None;
    }
    let from = start + (value.len() - value.trim_start_matches([' ', '\t']).len());
    let trimmed = value.trim_start_matches([' ', '\t']).trim_end();
    (!trimmed.is_empty()).then(|| (from, from + trimmed.len()))
}

/// `Name <address>`, the address a mailto link, senders joined by commas.
fn address_html(address: &Address) -> String {
    let mut rendered = Vec::new();
    for addr in address.iter() {
        let name = addr
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty());
        let email = addr
            .address
            .as_deref()
            .map(str::trim)
            .filter(|email| !email.is_empty());
        let link = email.map(|email| {
            format!(
                "<a href=\"mailto:{}\">{}</a>",
                encode_double_quoted_attribute(email),
                encode_text(email)
            )
        });
        match (name, link) {
            (Some(name), Some(link)) => {
                rendered.push(format!("{} &lt;{link}&gt;", encode_text(name)))
            }
            (None, Some(link)) => rendered.push(link),
            (Some(name), None) => rendered.push(encode_text(name).into_owned()),
            (None, None) => {}
        }
    }
    rendered.join(", ")
}

/// The Markdown raw-HTML policy plus the `cid:` scheme, which survives only long enough for [`embed_cid_images`] to resolve it.
fn sanitize_email_html(html: &str) -> String {
    let mut sanitizer = Builder::new();
    configure_rendered_html_sanitizer(&mut sanitizer);
    sanitizer.url_schemes(
        RENDERED_HTML_URL_SCHEMES
            .into_iter()
            .chain(["cid"])
            .collect(),
    );
    sanitizer.clean(html).to_string()
}

/// Swap every `<img src="cid:…">` whose id names a message part for a `data:` image built from that part. Ids that match nothing stay `cid:`, which the page's CSP refuses to load — a blank image, never a fetch. Runs on sanitized HTML, so tag boundaries are trustworthy.
fn embed_cid_images(html: &str, message: &Message, embedded_ids: &mut HashSet<String>) -> String {
    let mut out = String::with_capacity(html.len());
    let mut offset = 0usize;

    while let Some(relative_start) = html[offset..].find('<') {
        let tag_start = offset + relative_start;
        out.push_str(&html[offset..tag_start]);
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            out.push_str(&html[tag_start..]);
            return out;
        };
        out.push_str(&resolve_cid_img_tag(
            &html[tag_start..tag_end],
            message,
            embedded_ids,
        ));
        offset = tag_end;
    }

    out.push_str(&html[offset..]);
    out
}

/// One tag: rewritten when it is an `<img>` with a resolvable `cid:` source, returned as written otherwise.
fn resolve_cid_img_tag(tag: &str, message: &Message, embedded_ids: &mut HashSet<String>) -> String {
    if html_tag_name(tag).as_deref() != Some("img") {
        return tag.to_string();
    }
    let Some(attribute) = find_html_attribute(tag, "src") else {
        return tag.to_string();
    };
    // The sanitizer entity-encodes attribute values; the content id compares raw.
    let value = decode_html_entities(attribute.value);
    let Some(content_id) = value.trim().strip_prefix("cid:") else {
        return tag.to_string();
    };
    let Some(data_url) = cid_data_url(message, content_id) else {
        return tag.to_string();
    };
    embedded_ids.insert(content_id.to_ascii_lowercase());

    let mut resolved = String::with_capacity(tag.len() + data_url.len());
    resolved.push_str(&tag[..attribute.replacement_start]);
    if attribute.was_quoted {
        resolved.push_str(&data_url);
    } else {
        resolved.push('"');
        resolved.push_str(&data_url);
        resolved.push('"');
    }
    resolved.push_str(&tag[attribute.replacement_end..]);
    resolved
}

/// The `data:` URL for the image part `content_id` names, or `None` when no part matches or the part isn't an image. The URL is built entirely here — base64 alphabet and a checked MIME type — so it is safe inside an attribute.
fn cid_data_url(message: &Message, content_id: &str) -> Option<String> {
    let part = message.parts.iter().find(|part| {
        part.content_id()
            .is_some_and(|id| id.eq_ignore_ascii_case(content_id))
    })?;
    let mime = part.content_type().and_then(image_mime_type)?;
    Some(format!(
        "data:{mime};base64,{}",
        base64_encode(part.contents())
    ))
}

/// `image/<subtype>` when the content type is an image with a plain subtype; `None` for anything else, so only images ever embed.
fn image_mime_type(content_type: &mail_parser::ContentType) -> Option<String> {
    if !content_type.ctype().eq_ignore_ascii_case("image") {
        return None;
    }
    let subtype = content_type.subtype()?.to_ascii_lowercase();
    let plain = !subtype.is_empty()
        && subtype
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'));
    plain.then(|| format!("image/{subtype}"))
}

/// A plain-text body as paragraphs: blank lines split, single newlines break, bare URLs link — the same courtesy the reading view pays Markdown text. `stamped` carries the body's own offset in the file when these are the file's own words, and every paragraph then opens where it is read.
fn plain_text_body_html(text: &str, mut stamped: Option<(usize, &mut EmlBlocks)>) -> String {
    let mut out = String::new();
    for (at, paragraph) in plain_text_paragraph_spans(text) {
        let lines: Vec<String> = paragraph
            .lines()
            .map(linkify_plain_line)
            .filter(|line| !line.is_empty())
            .collect();
        // Nothing drawn, so nothing to open: a chunk of blank lines contributes no stamp.
        if lines.is_empty() {
            continue;
        }
        let attrs = match &mut stamped {
            Some((offset, blocks)) => blocks.attrs(
                "email_paragraph",
                *offset + at,
                *offset + at + paragraph.len(),
            ),
            None => String::new(),
        };
        // The break carries no newline of its own: a stamped paragraph's text has to be the message's bytes and nothing else, or the page cannot write it back.
        out.push_str(&format!("<p{attrs}>{}</p>\n", lines.join("<br>")));
    }
    out
}

/// Every paragraph of a plain-text body and where it starts, walked with the line endings intact so an offset is the file's own. A blank line ends a paragraph however either line was ended, and a run of them is one break; the ending that closes the last paragraph stays outside its range.
fn plain_text_paragraph_spans(text: &str) -> Vec<(usize, &str)> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut at = 0usize;
    while at < bytes.len() {
        let Some(first) = line_ending_len(bytes, at) else {
            at += 1;
            continue;
        };
        let Some(second) = line_ending_len(bytes, at + first) else {
            at += first;
            continue;
        };
        out.push(paragraph_span(text, start, at));
        at += first + second;
        while let Some(more) = line_ending_len(bytes, at) {
            at += more;
        }
        start = at;
    }
    out.push(paragraph_span(text, start, text.len()));
    out
}

/// One chunk with its blank edges cut away, so a range holds the paragraph's own bytes and no line ending on either side of it.
fn paragraph_span(text: &str, from: usize, to: usize) -> (usize, &str) {
    let (mut from, mut to) = (from, to);
    while let Some(len) = line_ending_len(text.as_bytes(), from).filter(|len| from + len <= to) {
        from += len;
    }
    loop {
        let slice = &text[from..to];
        if slice.ends_with("\r\n") {
            to -= 2;
        } else if slice.ends_with('\n') {
            to -= 1;
        } else {
            break;
        }
    }
    (from, &text[from..to])
}

/// The length of the line ending at `at`, or `None` where the line runs on.
fn line_ending_len(bytes: &[u8], at: usize) -> Option<usize> {
    match bytes.get(at)? {
        b'\n' => Some(1),
        b'\r' if bytes.get(at + 1) == Some(&b'\n') => Some(2),
        _ => None,
    }
}

/// Escape one line of plain text, turning each bare `http(s)` URL into a link.
fn linkify_plain_line(line: &str) -> String {
    let mut finder = LinkFinder::new();
    finder.kinds(&[LinkKind::Url]);
    let mut out = String::new();
    let mut last = 0usize;
    for link in finder.links(line) {
        out.push_str(&encode_text(&line[last..link.start()]));
        out.push_str(&format!(
            "<a href=\"{}\">{}</a>",
            encode_double_quoted_attribute(link.as_str()),
            encode_text(link.as_str())
        ));
        last = link.end();
    }
    out.push_str(&encode_text(&line[last..]));
    out
}

/// The attachment list: name, type and size for every part that isn't a body and didn't already appear inline in the HTML.
fn attachments_html(message: &Message, embedded_ids: &HashSet<String>) -> String {
    let mut items = String::new();
    for part in message.attachments() {
        if part
            .content_id()
            .is_some_and(|id| embedded_ids.contains(&id.to_ascii_lowercase()))
        {
            continue;
        }
        let name = part
            .attachment_name()
            .map(str::trim)
            .filter(|name| !name.is_empty());
        let name = name.unwrap_or(if part.is_message() {
            "Attached message"
        } else {
            "Attachment"
        });
        let mut detail = Vec::new();
        if let Some(content_type) = part.content_type() {
            detail.push(match content_type.subtype() {
                Some(subtype) => format!("{}/{subtype}", content_type.ctype()),
                None => content_type.ctype().to_string(),
            });
        }
        detail.push(human_size(part.contents().len()));
        items.push_str(&format!(
            "<li>{} <span class=\"data-value-attrs\">({})</span></li>\n",
            encode_text(name),
            encode_text(&detail.join(", "))
        ));
    }
    if items.is_empty() {
        return String::new();
    }
    format!(
        "<h2 id=\"attachments\">Attachments</h2>\n<ul class=\"email-attachments\">\n{items}</ul>\n"
    )
}

/// A byte count a person can read at a glance.
fn human_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// Standard base64, padded. Small enough that a dependency would cost more than it saves.
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let group = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let value = u32::from_be_bytes([0, group[0], group[1], group[2]]);
        let quad = [
            (value >> 18) & 63,
            (value >> 12) & 63,
            (value >> 6) & 63,
            value & 63,
        ];
        let kept = chunk.len() + 1;
        for (index, sextet) in quad.into_iter().enumerate() {
            out.push(if index < kept {
                ALPHABET[sextet as usize] as char
            } else {
                '='
            });
        }
    }
    out
}
