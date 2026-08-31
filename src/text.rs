use crate::*;
use html_escape::encode_text;

/// Render a plain text file: the file-name heading, then the whole file as one preformatted block kept exactly as typed. Nothing is parsed, because the app was never told what shape the file is in — a banner, an indented list and a hand-wrapped paragraph are all drawn as they were saved rather than reflowed into prose. The block carries no source range and the document answers an empty block source map: a range covering the whole file would draw the source view a second time inside the reading view, which is why HTML answers the same way.
pub(crate) fn render_text_document(
    source: &str,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    let heading = fallback_title
        .and_then(plain_document_title)
        .map(|title| {
            format!(
                "<h1 id=\"{}\"{BORROWED_TITLE_ATTR}>{}</h1>\n",
                tei_slugify(&title),
                encode_text(&title)
            )
        })
        .unwrap_or_default();
    (
        None,
        format!("{heading}<pre><code>{}</code></pre>\n", encode_text(source)),
        Vec::new(),
    )
}
