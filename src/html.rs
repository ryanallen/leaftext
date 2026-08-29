use crate::*;
use ammonia::Builder;
use html_escape::encode_text;

/// Render a complete HTML page through the same boundary as raw HTML in Markdown. The source view remains the editing surface because sanitizing cannot preserve proved byte ranges.
pub(crate) fn render_html_document(
    source: &str,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    let mut sanitizer = Builder::new();
    configure_rendered_html_sanitizer(&mut sanitizer);
    let body = sanitizer.clean(source).to_string();
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
    (None, format!("{heading}{body}"), Vec::new())
}
