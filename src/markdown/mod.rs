//! Markdown rendering: parse, apply the GitHub extras, highlight, sanitize.
//!
//! The stages live in the sibling files; this one holds the pipeline that runs
//! them in order.

mod code;
mod events;
mod footnotes;
mod github;
mod headings;
mod htmlparse;
mod image_protocol;
mod images;
mod paths;
mod rawhtml;

// Re-exported so `markdown::x` reaches every item, wherever it lives.
pub(crate) use code::*;
pub(crate) use events::*;
pub(crate) use footnotes::*;
pub(crate) use github::*;
pub(crate) use headings::*;
pub(crate) use htmlparse::*;
pub(crate) use image_protocol::*;
pub(crate) use images::*;
pub(crate) use paths::*;
pub(crate) use rawhtml::*;

// The crate's public surface. A pub(crate) glob cannot carry these out of the
// crate, and lib.rs re-exports them, so name them explicitly.
pub use image_protocol::{
    is_local_image_path, local_image_protocol_response, local_image_source_dir,
};
pub use images::markdown_image_insert_destination;

use crate::*;

#[derive(Debug, Clone, Copy)]
pub(crate) struct MarkdownSource<'a> {
    pub(crate) markdown: &'a str,
    pub(crate) source_path: &'a Path,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct MarkdownParserConfig {
    pub(crate) options: Options,
}

impl MarkdownParserConfig {
    pub(crate) fn github_flavored() -> Self {
        Self {
            options: markdown_options(),
        }
    }
}

pub(crate) fn render_markdown_body(source: MarkdownSource<'_>) -> String {
    // A leading `--- ... ---` block renders as a metadata table, not raw
    // Markdown (which would become a stray heading/thematic break).
    let (frontmatter_html, body_markdown) = match split_leading_frontmatter(source.markdown) {
        Some((inner, rest)) => (render_frontmatter_table(&inner), rest),
        None => (String::new(), source.markdown),
    };
    let parser_config = MarkdownParserConfig::github_flavored();
    let events = parse_markdown_source(body_markdown, parser_config);
    let events = sanitize_raw_markdown_html(events);
    let events = register_markdown_extensions(events, source.source_path);
    let body = render_markdown_events_to_html(events);
    let body = resolve_rendered_html_image_urls(&body, source.source_path);
    let body = format!("{frontmatter_html}{body}");
    sanitize_rendered_html(&body)
}

/// Split a leading `--- ... ---` frontmatter block off the front, returning its
/// inner text and the Markdown that follows. Detected only when `---` is the
/// first line and a later `---` closes it, like the indexer.
///
/// A leading mark should never arrive — [`read_source`] takes it off precisely so it
/// can't stop a fence being first on the line — but Markdown also reaches here from
/// the code view's buffer and from tests, so one is still stepped over.
pub(crate) fn split_leading_frontmatter(markdown: &str) -> Option<(String, &str)> {
    let after_bom = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    let first_end = after_bom
        .find('\n')
        .map(|i| i + 1)
        .unwrap_or(after_bom.len());
    if after_bom[..first_end]
        .trim_end_matches(['\r', '\n'])
        .trim_end()
        != "---"
    {
        return None;
    }
    let inner_start = first_end;
    let mut offset = first_end;
    while offset < after_bom.len() {
        let line_end = after_bom[offset..]
            .find('\n')
            .map(|i| offset + i + 1)
            .unwrap_or(after_bom.len());
        if after_bom[offset..line_end]
            .trim_end_matches(['\r', '\n'])
            .trim_end()
            == "---"
        {
            return Some((
                after_bom[inner_start..offset].to_string(),
                &after_bom[line_end..],
            ));
        }
        offset = line_end;
    }
    None
}

/// Render a parsed frontmatter block as a `key`/`value` metadata table, or an
/// empty string when nothing parses. Cells are untrusted, so they're escaped.
pub(crate) fn render_frontmatter_table(inner: &str) -> String {
    let block = crate::store::FrontmatterBlock {
        body: inner.to_string(),
    };
    let fields = crate::store::parse_frontmatter(&block)
        .map(|parsed| parsed.fields)
        .unwrap_or_default();
    if fields.is_empty() {
        return String::new();
    }
    let mut rows = String::new();
    for field in &fields {
        rows.push_str("<tr><th>");
        rows.push_str(&encode_text(&field.key));
        rows.push_str("</th><td>");
        rows.push_str(&encode_text(&field.value));
        rows.push_str("</td></tr>");
    }
    format!(r#"<div class="frontmatter"><table><tbody>{rows}</tbody></table></div>"#)
}

pub(crate) fn parse_markdown_source(
    markdown: &str,
    parser_config: MarkdownParserConfig,
) -> Vec<Event<'static>> {
    Parser::new_ext(markdown, parser_config.options)
        .map(Event::into_static)
        .collect()
}

pub(crate) fn register_markdown_extensions(
    events: Vec<Event<'static>>,
    source_path: &Path,
) -> Vec<Event<'static>> {
    let repository = repository_context(source_path.parent().unwrap_or_else(|| Path::new(".")));
    let events = button_links(events);
    let events = linkify_plain_text(events);
    let events = github_markdown_extras(events, repository.as_ref());
    let events = table_cell_task_list_markers(events);
    let events = add_markdown_heading_ids(events);
    let events = resolve_absolute_markdown_image_urls(events, source_path);
    fill_image_titles_from_alt(events)
}

pub(crate) fn render_markdown_events_to_html(events: Vec<Event<'static>>) -> String {
    let mut body = String::new();
    html::push_html(&mut body, events.into_iter());
    body
}

pub(crate) fn markdown_options() -> Options {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_GFM);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_MATH);
    options
}

pub(crate) fn cowstr(value: &str) -> CowStr<'static> {
    CowStr::Boxed(value.to_string().into_boxed_str())
}
