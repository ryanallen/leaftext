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
/// first line (after an optional BOM) and a later `---` closes it, like the
/// indexer.
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
    let block = crate::indexer::FrontmatterBlock {
        body: inner.to_string(),
    };
    let fields = crate::indexer::parse_frontmatter(&block)
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

/// Leaf custom Markdown: a link wrapped in braces renders as a button — an
/// `<a class="leaf-md-button …">` styled like the app's action buttons. The more
/// braces, the more prominent the button:
///
/// - `{[Label](url)}` → ghost (no fill or outline until hover)
/// - `{{[Label](url)}}` → outline (fills on hover)
/// - `{{{[Label](url)}}}` → filled
///
/// Braces only: brackets would be read as link syntax, leaving the wrapper behind
/// as literal text beside a plain link.
///
/// Links can't nest in CommonMark, so the braces stay literal: they arrive as the
/// tail of the Text before the link and the head of the Text after it. We strip
/// the matched run from each side and wrap the label in the button anchor. Working
/// on Link events is what keeps the syntax literal inside code.
pub(crate) fn button_links(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut out: Vec<Event<'static>> = Vec::with_capacity(events.len());
    let mut index = 0;
    while index < events.len() {
        if let Event::Start(Tag::Link { dest_url, .. }) = &events[index] {
            if let Some(end) = link_end_index(&events, index) {
                // Braces merge with adjacent prose, so each side is a run at one
                // Text boundary.
                let open = out_trailing_run(&out, '{');
                let close = event_leading_run(events.get(end + 1), '}');

                // Lopsided wrappers are prose, not a button, and are left alone.
                let variant = (open == close)
                    .then(|| match open {
                        1 => Some(" leaf-md-button--ghost"),
                        2 => Some(" leaf-md-button--secondary"),
                        3 => Some(""),
                        _ => None,
                    })
                    .flatten();

                if let Some(variant) = variant {
                    strip_out_trailing_chars(&mut out, open);
                    out.push(Event::InlineHtml(cowstr(&format!(
                        r#"<a class="leaf-md-button{variant}" href="{}">"#,
                        encode_double_quoted_attribute(dest_url.as_ref())
                    ))));
                    out.extend(events[index + 1..end].iter().cloned());
                    out.push(Event::InlineHtml(cowstr("</a>")));
                    // Keep any prose that merged onto the far side of the braces.
                    if let Some(Event::Text(text)) = events.get(end + 1) {
                        let tail = &text.as_ref()[close..];
                        if !tail.is_empty() {
                            out.push(Event::Text(cowstr(tail)));
                        }
                    }
                    index = end + 2;
                    continue;
                }
            }
        }
        out.push(events[index].clone());
        index += 1;
    }
    out
}

/// The text of `event`, if it is a `Text` event.
fn event_text<'a>(event: &'a Event<'static>) -> Option<&'a str> {
    match event {
        Event::Text(text) => Some(text.as_ref()),
        _ => None,
    }
}

/// How many `ch` in a row `event`'s text opens with, if it is a `Text` event.
fn event_leading_run(event: Option<&Event<'static>>, ch: char) -> usize {
    event
        .and_then(event_text)
        .map(|text| text.chars().take_while(|c| *c == ch).count())
        .unwrap_or(0)
}

/// How many `ch` in a row the last event in `out` ends with, if it is a `Text`.
fn out_trailing_run(out: &[Event<'static>], ch: char) -> usize {
    out.last()
        .and_then(event_text)
        .map(|text| text.chars().rev().take_while(|c| *c == ch).count())
        .unwrap_or(0)
}

/// Drop the last `count` (single-byte wrapper) characters from the final `Text`
/// event in `out`, removing the event entirely if that empties it.
fn strip_out_trailing_chars(out: &mut Vec<Event<'static>>, count: usize) {
    if let Some(Event::Text(text)) = out.last() {
        let trimmed = &text.as_ref()[..text.len() - count];
        if trimmed.is_empty() {
            out.pop();
        } else {
            let replacement = Event::Text(cowstr(trimmed));
            if let Some(last) = out.last_mut() {
                *last = replacement;
            }
        }
    }
}

/// Index of the `End(Link)` that closes the `Start(Link)` at `start`. Links can't
/// nest, so it's the first link end after the start.
fn link_end_index(events: &[Event<'static>], start: usize) -> Option<usize> {
    events[start + 1..]
        .iter()
        .position(|event| matches!(event, Event::End(TagEnd::Link)))
        .map(|offset| start + 1 + offset)
}

pub(crate) fn table_cell_task_list_markers(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut transformed = Vec::with_capacity(events.len());
    let mut table_cell: Option<Vec<Event<'static>>> = None;

    for event in events {
        if let Some(mut cell_events) = table_cell.take() {
            match event {
                Event::End(TagEnd::TableCell) => {
                    if let Some(checked) = table_cell_task_marker(&cell_events) {
                        transformed.push(Event::TaskListMarker(checked));
                    } else {
                        transformed.extend(cell_events);
                    }
                    transformed.push(Event::End(TagEnd::TableCell));
                }
                other => {
                    cell_events.push(other);
                    table_cell = Some(cell_events);
                }
            }
            continue;
        }

        match event {
            Event::Start(Tag::TableCell) => {
                transformed.push(Event::Start(Tag::TableCell));
                table_cell = Some(Vec::new());
            }
            other => transformed.push(other),
        }
    }

    if let Some(cell_events) = table_cell {
        transformed.extend(cell_events);
    }

    transformed
}

pub(crate) fn table_cell_task_marker(events: &[Event<'static>]) -> Option<bool> {
    let mut text = String::new();
    let mut saw_text = false;

    for event in events {
        match event {
            Event::Text(value) => {
                saw_text = true;
                text.push_str(value.as_ref());
            }
            Event::SoftBreak | Event::HardBreak => text.push('\n'),
            _ => return None,
        }
    }

    if !saw_text {
        return None;
    }

    match text.trim() {
        "[ ]" => Some(false),
        "[x]" | "[X]" => Some(true),
        _ => None,
    }
}

pub(crate) fn add_markdown_heading_ids(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut transformed = Vec::with_capacity(events.len());
    let mut seen = HashSet::new();
    let mut heading: Option<HeadingIdCapture> = None;

    for event in events {
        if let Some(capture) = &mut heading {
            match event {
                Event::End(TagEnd::Heading(level)) => {
                    let slug = unique_heading_slug(&capture.text, &mut seen);
                    transformed.push(Event::Start(Tag::Heading {
                        level,
                        id: Some(cowstr(&slug)),
                        classes: capture.classes.clone(),
                        attrs: capture.attrs.clone(),
                    }));
                    transformed.extend(capture.events.drain(..));
                    transformed.push(Event::End(TagEnd::Heading(level)));
                    heading = None;
                }
                other => {
                    append_heading_slug_text(&other, &mut capture.text);
                    capture.events.push(other);
                }
            }
            continue;
        }

        match event {
            Event::Start(Tag::Heading {
                level,
                id: Some(id),
                classes,
                attrs,
            }) => {
                seen.insert(id.to_string());
                transformed.push(Event::Start(Tag::Heading {
                    level,
                    id: Some(id),
                    classes,
                    attrs,
                }));
            }
            Event::Start(Tag::Heading {
                level,
                id: None,
                classes,
                attrs,
            }) => {
                heading = Some(HeadingIdCapture {
                    level,
                    classes,
                    attrs,
                    events: Vec::new(),
                    text: String::new(),
                });
            }
            other => transformed.push(other),
        }
    }

    if let Some(mut capture) = heading {
        let slug = unique_heading_slug(&capture.text, &mut seen);
        transformed.push(Event::Start(Tag::Heading {
            level: capture.level,
            id: Some(cowstr(&slug)),
            classes: capture.classes,
            attrs: capture.attrs,
        }));
        transformed.extend(capture.events.drain(..));
    }

    transformed
}

#[derive(Debug)]
pub(crate) struct HeadingIdCapture {
    level: HeadingLevel,
    classes: Vec<CowStr<'static>>,
    attrs: Vec<(CowStr<'static>, Option<CowStr<'static>>)>,
    events: Vec<Event<'static>>,
    text: String,
}

pub(crate) fn append_heading_slug_text(event: &Event<'_>, text: &mut String) {
    match event {
        Event::Text(value) | Event::Code(value) => text.push_str(value.as_ref()),
        Event::InlineHtml(value) | Event::Html(value) => {
            text.push_str(&strip_html_tags(value.as_ref()));
        }
        Event::SoftBreak | Event::HardBreak => text.push(' '),
        _ => {}
    }
}

pub(crate) fn strip_html_tags(value: &str) -> String {
    let mut stripped = String::with_capacity(value.len());
    let mut in_tag = false;

    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => stripped.push(character),
            _ => {}
        }
    }

    stripped
}

pub(crate) fn unique_heading_slug(text: &str, seen: &mut HashSet<String>) -> String {
    let base = heading_slug_base(text);
    if seen.insert(base.clone()) {
        return base;
    }

    let mut index = 1usize;
    loop {
        let candidate = format!("{base}-{index}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
        index += 1;
    }
}

pub(crate) fn heading_slug_base(text: &str) -> String {
    let normalized = text.trim().to_lowercase();
    let mut slug = String::with_capacity(normalized.len());

    for character in normalized.chars() {
        if character.is_alphanumeric() || matches!(character, '_' | '-') {
            slug.push(character);
        } else if character.is_whitespace() {
            slug.push('-');
        }
    }

    if slug.is_empty() {
        "heading".to_string()
    } else {
        slug
    }
}

pub(crate) fn sanitize_raw_markdown_html(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut sanitized = Vec::with_capacity(events.len());
    let mut skipped_raw_html_content: Option<&'static str> = None;

    for event in events {
        if let Some(tag_name) = skipped_raw_html_content {
            if let Event::Html(html) | Event::InlineHtml(html) = &event {
                if closes_raw_html_content_tag(html, tag_name) {
                    skipped_raw_html_content = None;
                }
            }
            continue;
        }

        match event {
            Event::Html(html) => {
                if let Some(tag_name) = opens_unclosed_raw_html_content_tag(&html) {
                    skipped_raw_html_content = Some(tag_name);
                }
                sanitized.push(Event::Html(cowstr(&sanitize_raw_markdown_html_fragment(
                    &html,
                ))));
            }
            Event::InlineHtml(html) => {
                if let Some(tag_name) = opens_unclosed_raw_html_content_tag(&html) {
                    skipped_raw_html_content = Some(tag_name);
                }
                sanitized.push(Event::InlineHtml(cowstr(
                    &sanitize_raw_markdown_html_fragment(&html),
                )));
            }
            _ => sanitized.push(event),
        }
    }

    sanitized
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

pub(crate) fn linkify_plain_text(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut finder = LinkFinder::new();
    finder
        .kinds(&[LinkKind::Url, LinkKind::Email])
        .url_must_have_scheme(false);

    let mut link_depth = 0usize;
    let mut transformed = Vec::new();

    for event in events {
        match event {
            Event::Start(Tag::Link { .. }) | Event::Start(Tag::Image { .. }) => {
                link_depth += 1;
                transformed.push(event);
            }
            Event::End(TagEnd::Link) | Event::End(TagEnd::Image) => {
                link_depth = link_depth.saturating_sub(1);
                transformed.push(event);
            }
            Event::Text(text) if link_depth == 0 => {
                append_autolink_events(text.as_ref(), &finder, &mut transformed);
            }
            _ => transformed.push(event),
        }
    }

    transformed
}

pub(crate) fn github_markdown_extras(
    events: Vec<Event<'static>>,
    repository: Option<&RepositoryContext>,
) -> Vec<Event<'static>> {
    let mut transformed = Vec::new();
    let mut link_depth = 0usize;
    let mut code_block: Option<CodeBlockCapture> = None;
    let mut footnotes = FootnoteTracker::default();
    let mut current_footnote: Option<String> = None;
    // Where each definition's events landed in `transformed`, so they can be
    // hoisted to the end (as GitHub does) once every reference is numbered.
    let mut footnote_ranges: Vec<(String, usize, usize)> = Vec::new();
    let mut footnote_start = 0usize;

    for event in events {
        if let Some(capture) = &mut code_block {
            match event {
                Event::Text(text) => capture.code.push_str(text.as_ref()),
                Event::End(TagEnd::CodeBlock) => {
                    transformed.push(Event::Html(cowstr(&render_code_block(capture))));
                    code_block = None;
                }
                _ => {}
            }
            continue;
        }

        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(info))) => {
                code_block = Some(CodeBlockCapture {
                    language: info
                        .split_whitespace()
                        .next()
                        .map(str::to_string)
                        .filter(|language| !language.is_empty()),
                    code: String::new(),
                });
            }
            Event::Start(Tag::Link { .. }) | Event::Start(Tag::Image { .. }) => {
                link_depth += 1;
                transformed.push(event);
            }
            Event::End(TagEnd::Link) | Event::End(TagEnd::Image) => {
                link_depth = link_depth.saturating_sub(1);
                transformed.push(event);
            }
            Event::Text(text) if link_depth == 0 => {
                append_github_text_events(text.as_ref(), repository, &mut transformed);
            }
            Event::Start(Tag::FootnoteDefinition(name)) => {
                current_footnote = Some(name.to_string());
                footnote_start = transformed.len();
                transformed.push(Event::Start(Tag::FootnoteDefinition(name)));
            }
            Event::End(TagEnd::FootnoteDefinition) => {
                if let Some(name) = current_footnote.take() {
                    let backlink = Event::Html(cowstr(&render_footnote_backlink(&name)));
                    // Insert inside the last paragraph so the icon sits inline at
                    // the sentence end, not as a separate block below it.
                    let last_para_end = (footnote_start..transformed.len())
                        .rev()
                        .find(|&i| matches!(transformed[i], Event::End(TagEnd::Paragraph)));
                    if let Some(idx) = last_para_end {
                        transformed.insert(idx, backlink);
                    } else {
                        transformed.push(backlink);
                    }
                    transformed.push(Event::End(TagEnd::FootnoteDefinition));
                    footnote_ranges.push((name, footnote_start, transformed.len()));
                } else {
                    transformed.push(Event::End(TagEnd::FootnoteDefinition));
                }
            }
            Event::FootnoteReference(name) => {
                transformed.push(Event::Html(cowstr(&footnotes.render_reference(&name))));
            }
            Event::DisplayMath(text) => {
                transformed.push(Event::DisplayMath(cowstr(text.trim())));
            }
            Event::InlineMath(text) => {
                transformed.push(Event::InlineMath(cowstr(text.trim())));
            }
            _ => transformed.push(event),
        }
    }

    if let Some(capture) = &code_block {
        transformed.push(Event::Html(cowstr(&render_code_block(capture))));
    }

    relocate_footnote_definitions(transformed, footnote_ranges, &footnotes)
}

/// Move every footnote definition to the end of the document in reference order
/// (unreferenced ones trailing in source order), mirroring GitHub. Emitting them
/// in reference order also lines up pulldown-cmark's printed labels with the
/// superscript numbers, since its HTML writer labels by emission order.
pub(crate) fn relocate_footnote_definitions(
    events: Vec<Event<'static>>,
    ranges: Vec<(String, usize, usize)>,
    footnotes: &FootnoteTracker,
) -> Vec<Event<'static>> {
    if ranges.is_empty() {
        return events;
    }

    // Stable sort keeps unreferenced definitions (usize::MAX key) in source order.
    let mut order: Vec<usize> = (0..ranges.len()).collect();
    order.sort_by_key(|&i| footnotes.number_of(&ranges[i].0).unwrap_or(usize::MAX));

    let mut covered = vec![false; events.len()];
    for (_, start, end) in &ranges {
        for slot in covered.iter_mut().take(*end).skip(*start) {
            *slot = true;
        }
    }

    let mut slots: Vec<Option<Event<'static>>> = events.into_iter().map(Some).collect();
    let mut result = Vec::with_capacity(slots.len());
    for index in 0..slots.len() {
        if !covered[index] {
            result.push(slots[index].take().expect("event taken once"));
        }
    }
    for &i in &order {
        let (_, start, end) = &ranges[i];
        for index in *start..*end {
            result.push(slots[index].take().expect("footnote event taken once"));
        }
    }
    result
}

#[derive(Debug, Clone)]
pub(crate) struct CodeBlockCapture {
    pub(crate) language: Option<String>,
    pub(crate) code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RepositoryContext {
    owner: String,
    repo: String,
}

#[derive(Debug, Default)]
pub(crate) struct FootnoteTracker {
    numbers: HashMap<String, usize>,
}

impl FootnoteTracker {
    fn render_reference(&mut self, name: &str) -> String {
        let number = if let Some(number) = self.numbers.get(name) {
            *number
        } else {
            let number = self.numbers.len() + 1;
            self.numbers.insert(name.to_string(), number);
            number
        };

        format!(
            r##"<sup class="footnote-reference" id="fnref-{}"><a href="#{}">{}</a></sup>"##,
            encode_double_quoted_attribute(name),
            encode_double_quoted_attribute(name),
            number
        )
    }

    /// The number assigned to a footnote, or `None` if it was never referenced.
    fn number_of(&self, name: &str) -> Option<usize> {
        self.numbers.get(name).copied()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GithubToken {
    Issue {
        owner: String,
        repo: String,
        number: String,
        text: String,
    },
    Commit {
        owner: String,
        repo: String,
        hash: String,
    },
    Mention {
        text: String,
    },
    Emoji {
        shortcode: String,
        glyph: &'static str,
    },
}

pub(crate) fn append_github_text_events(
    text: &str,
    repository: Option<&RepositoryContext>,
    events: &mut Vec<Event<'static>>,
) {
    let mut offset = 0;

    while offset < text.len() {
        if let Some((start, end, token)) = next_github_token(&text[offset..], repository) {
            if start > 0 {
                events.push(Event::Text(cowstr(&text[offset..offset + start])));
            }
            events.push(Event::Html(cowstr(&render_github_token(&token))));
            offset += end;
        } else {
            events.push(Event::Text(cowstr(&text[offset..])));
            break;
        }
    }
}

pub(crate) fn next_github_token(
    text: &str,
    repository: Option<&RepositoryContext>,
) -> Option<(usize, usize, GithubToken)> {
    text.char_indices()
        .filter_map(|(index, char)| {
            if index > 0 && !is_token_boundary(text[..index].chars().last()) {
                return None;
            }

            let tail = &text[index..];
            let token = match char {
                ':' => emoji_token(tail),
                '@' => mention_token(tail),
                '#' => issue_token(tail, repository),
                'A'..='Z' | 'a'..='z' | '0'..='9' => {
                    issue_token(tail, repository).or_else(|| commit_token(tail, repository))
                }
                _ => None,
            }?;
            Some((index, index + token_text_len(&token), token))
        })
        .next()
}

pub(crate) fn token_text_len(token: &GithubToken) -> usize {
    match token {
        GithubToken::Issue { text, .. } => text.len(),
        GithubToken::Commit { hash, .. } => hash.len(),
        GithubToken::Mention { text } => text.len(),
        GithubToken::Emoji { shortcode, .. } => shortcode.len(),
    }
}

pub(crate) fn emoji_token(text: &str) -> Option<GithubToken> {
    let rest = text.strip_prefix(':')?;
    let end = rest.find(':')? + 2;
    let shortcode = &text[..end];
    let glyph = match shortcode {
        ":shipit:" => "🚢",
        ":rocket:" => "🚀",
        ":tada:" => "🎉",
        ":warning:" => "⚠️",
        ":white_check_mark:" => "✅",
        _ => return None,
    };

    Some(GithubToken::Emoji {
        shortcode: shortcode.to_string(),
        glyph,
    })
}

pub(crate) fn mention_token(text: &str) -> Option<GithubToken> {
    let username_end = take_identifier(&text[1..])? + 1;
    let mut end = username_end;

    if text[username_end..].starts_with('/') {
        let team_start = username_end + 1;
        end = take_identifier(&text[team_start..])? + team_start;
    }

    if !is_token_boundary(text[end..].chars().next()) {
        return None;
    }

    Some(GithubToken::Mention {
        text: text[..end].to_string(),
    })
}

pub(crate) fn issue_token(
    text: &str,
    repository: Option<&RepositoryContext>,
) -> Option<GithubToken> {
    if let Some(number) = text.strip_prefix('#').and_then(take_digits_text) {
        let repository = repository?;
        return issue_token_with_context(repository, number, &format!("#{number}"));
    }

    if let Some(number) = text.strip_prefix("GH-").and_then(take_digits_text) {
        let repository = repository?;
        return issue_token_with_context(repository, number, &format!("GH-{number}"));
    }

    let owner_end = take_identifier(text)?;
    if !text[owner_end..].starts_with('/') {
        return None;
    }
    let repo_start = owner_end + 1;
    let repo_end = take_repo_name(&text[repo_start..])? + repo_start;
    if !text[repo_end..].starts_with('#') {
        return None;
    }
    let number_start = repo_end + 1;
    let number = take_digits_text(&text[number_start..])?;
    if !is_token_boundary(text[number_start + number.len()..].chars().next()) {
        return None;
    }

    issue_token_with_context(
        &RepositoryContext {
            owner: text[..owner_end].to_string(),
            repo: text[repo_start..repo_end].to_string(),
        },
        number,
        &text[..number_start + number.len()],
    )
}

pub(crate) fn issue_token_with_context(
    repository: &RepositoryContext,
    number: &str,
    text: &str,
) -> Option<GithubToken> {
    Some(GithubToken::Issue {
        owner: repository.owner.clone(),
        repo: repository.repo.clone(),
        number: number.to_string(),
        text: text.to_string(),
    })
}

pub(crate) fn commit_token(
    text: &str,
    repository: Option<&RepositoryContext>,
) -> Option<GithubToken> {
    let repository = repository?;
    let hash_len = text
        .chars()
        .take_while(|char| char.is_ascii_hexdigit())
        .count();
    if hash_len != 7 && hash_len != 40 {
        return None;
    }
    let hash = &text[..hash_len];
    if !hash.chars().any(|char| char.is_ascii_alphabetic())
        || !is_token_boundary(text[hash_len..].chars().next())
    {
        return None;
    }

    Some(GithubToken::Commit {
        owner: repository.owner.clone(),
        repo: repository.repo.clone(),
        hash: hash.to_string(),
    })
}

pub(crate) fn take_identifier(text: &str) -> Option<usize> {
    let mut end = 0;
    for (index, char) in text.char_indices() {
        if char.is_ascii_alphanumeric() || char == '-' {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    (end > 0).then_some(end)
}

pub(crate) fn take_repo_name(text: &str) -> Option<usize> {
    let mut end = 0;
    for (index, char) in text.char_indices() {
        if char.is_ascii_alphanumeric() || char == '-' || char == '_' || char == '.' {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    (end > 0).then_some(end)
}

pub(crate) fn take_digits_text(text: &str) -> Option<&str> {
    let end = text
        .char_indices()
        .take_while(|(_, char)| char.is_ascii_digit())
        .map(|(index, char)| index + char.len_utf8())
        .last()?;
    Some(&text[..end])
}

pub(crate) fn is_token_boundary(char: Option<char>) -> bool {
    char.map(|char| {
        !(char.is_ascii_alphanumeric() || matches!(char, '_' | '-' | '/' | '#' | '@' | ':'))
    })
    .unwrap_or(true)
}

pub(crate) fn render_github_token(token: &GithubToken) -> String {
    match token {
        GithubToken::Issue {
            owner,
            repo,
            number,
            text,
        } => format!(
            r#"<a class="github-ref issue-ref" href="https://github.com/{}/{}/issues/{}">{}</a>"#,
            encode_double_quoted_attribute(owner),
            encode_double_quoted_attribute(repo),
            encode_double_quoted_attribute(number),
            encode_text(text)
        ),
        GithubToken::Commit { owner, repo, hash } => format!(
            r#"<a class="github-ref commit-ref" href="https://github.com/{}/{}/commit/{}"><code>{}</code></a>"#,
            encode_double_quoted_attribute(owner),
            encode_double_quoted_attribute(repo),
            encode_double_quoted_attribute(hash),
            encode_text(hash)
        ),
        GithubToken::Mention { text } => format!(
            r#"<span class="github-mention">{}</span>"#,
            encode_text(text)
        ),
        GithubToken::Emoji { shortcode, glyph } => format!(
            r#"<span class="emoji" title="{}" aria-label="{}">{}</span>"#,
            encode_double_quoted_attribute(shortcode),
            encode_double_quoted_attribute(shortcode),
            glyph
        ),
    }
}

pub(crate) fn render_footnote_backlink(name: &str) -> String {
    format!(
        r##"<a class="footnote-backref" href="#fnref-{}" aria-label="Back to content">{}</a>"##,
        encode_double_quoted_attribute(name),
        footnote_backref_icon_svg()
    )
}

pub(crate) fn footnote_backref_icon_svg() -> &'static str {
    static ICON: OnceLock<String> = OnceLock::new();

    ICON.get_or_init(|| {
        normalize_svg_icon_colors(FOOTNOTE_BACKREF_ICON_SVG)
            .trim()
            .to_string()
    })
    .as_str()
}

pub(crate) fn render_code_block(capture: &CodeBlockCapture) -> String {
    let Some(language) = capture.language.as_deref() else {
        return format!("<pre><code>{}</code></pre>", encode_text(&capture.code));
    };

    if language.eq_ignore_ascii_case("mermaid") {
        return render_mermaid_code_block(&capture.code);
    }

    let requested_language = language;
    let language = language_definition(requested_language);
    let display_language = language
        .as_ref()
        .map(|language| language.display_name)
        .unwrap_or(requested_language);
    let language_class = format!("language-{}", safe_css_identifier(display_language));
    let highlighted = language
        .and_then(|language| highlight_code(&capture.code, &language))
        .unwrap_or_else(|| encode_text(&capture.code).to_string());
    format!(
        r#"<pre class="highlight" data-language="{}"><code class="{}">{}</code></pre>"#,
        encode_double_quoted_attribute(display_language),
        encode_double_quoted_attribute(&language_class),
        highlighted
    )
}

pub(crate) fn render_mermaid_code_block(code: &str) -> String {
    format!(
        r#"<pre class="mermaid" data-language="mermaid">{}</pre>"#,
        encode_text(mermaid_source_for_runtime(code))
    )
}

pub(crate) fn mermaid_source_for_runtime(code: &str) -> &str {
    strip_mermaid_yaml_frontmatter(code).unwrap_or(code)
}

pub(crate) fn strip_mermaid_yaml_frontmatter(code: &str) -> Option<&str> {
    let first_line_end = code.find('\n')?;
    let first_line = code[..first_line_end].trim_end_matches('\r');
    if first_line.trim() != "---" {
        return None;
    }

    let mut offset = first_line_end + 1;
    for line in code[offset..].split_inclusive('\n') {
        let line_without_newline = line
            .strip_suffix('\n')
            .unwrap_or(line)
            .trim_end_matches('\r');
        let next_offset = offset + line.len();
        if line_without_newline.trim() == "---" {
            return Some(&code[next_offset..]);
        }
        offset = next_offset;
    }

    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LanguageDefinition {
    pub(crate) display_name: &'static str,
    pub(crate) syntax_names: &'static [&'static str],
    pub(crate) syntax_tokens: &'static [&'static str],
}

pub(crate) fn language_definition(language: &str) -> Option<LanguageDefinition> {
    let normalized = language.trim().to_ascii_lowercase();
    let definition = match normalized.as_str() {
        "ts" | "typescript" => LanguageDefinition {
            display_name: "TypeScript",
            syntax_names: &["TypeScript"],
            syntax_tokens: &["ts", "typescript"],
        },
        "tsx" => LanguageDefinition {
            display_name: "TSX",
            syntax_names: &["TSX", "TypeScriptReact"],
            syntax_tokens: &["tsx"],
        },
        "js" | "javascript" => LanguageDefinition {
            display_name: "JavaScript",
            syntax_names: &["JavaScript"],
            syntax_tokens: &["js", "javascript"],
        },
        "jsx" => LanguageDefinition {
            display_name: "JSX",
            syntax_names: &["JSX", "JavaScriptReact"],
            syntax_tokens: &["jsx"],
        },
        "json" => LanguageDefinition {
            display_name: "JSON",
            syntax_names: &["JSON"],
            syntax_tokens: &["json"],
        },
        "jsonc" => LanguageDefinition {
            display_name: "JSONC",
            syntax_names: &["JSONC", "JSON with Comments", "JSON"],
            syntax_tokens: &["jsonc", "json"],
        },
        "html" => LanguageDefinition {
            display_name: "HTML",
            syntax_names: &["HTML"],
            syntax_tokens: &["html"],
        },
        "css" => LanguageDefinition {
            display_name: "CSS",
            syntax_names: &["CSS"],
            syntax_tokens: &["css"],
        },
        "scss" => LanguageDefinition {
            display_name: "SCSS",
            syntax_names: &["SCSS", "CSS"],
            syntax_tokens: &["scss", "css"],
        },
        "md" | "markdown" => LanguageDefinition {
            display_name: "Markdown",
            syntax_names: &["Markdown"],
            syntax_tokens: &["md", "markdown"],
        },
        "bash" | "sh" | "shell" | "zsh" => LanguageDefinition {
            display_name: "Bash",
            syntax_names: &[
                "Bourne Again Shell (bash)",
                "Shell-Unix-Generic",
                "ShellScript",
                "Bash",
            ],
            syntax_tokens: &["bash", "sh", "shell", "zsh"],
        },
        "yaml" | "yml" => LanguageDefinition {
            display_name: "YAML",
            syntax_names: &["YAML"],
            syntax_tokens: &["yaml", "yml"],
        },
        "toml" => LanguageDefinition {
            display_name: "TOML",
            syntax_names: &["TOML"],
            syntax_tokens: &["toml"],
        },
        "xml" => LanguageDefinition {
            display_name: "XML",
            syntax_names: &["XML"],
            syntax_tokens: &["xml"],
        },
        "rust" | "rs" => LanguageDefinition {
            display_name: "Rust",
            syntax_names: &["Rust"],
            syntax_tokens: &["rs", "rust"],
        },
        "python" | "py" => LanguageDefinition {
            display_name: "Python",
            syntax_names: &["Python"],
            syntax_tokens: &["python", "py"],
        },
        "sql" => LanguageDefinition {
            display_name: "SQL",
            syntax_names: &["SQL"],
            syntax_tokens: &["sql"],
        },
        "diff" | "patch" => LanguageDefinition {
            display_name: "Diff",
            syntax_names: &["Diff"],
            syntax_tokens: &["diff", "patch"],
        },
        "ini" => LanguageDefinition {
            display_name: "INI",
            syntax_names: &["INI"],
            syntax_tokens: &["ini"],
        },
        "dotenv" => LanguageDefinition {
            display_name: "Dotenv",
            syntax_names: &["DotENV", "dotenv"],
            syntax_tokens: &["dotenv", "env"],
        },
        "dockerfile" => LanguageDefinition {
            display_name: "Dockerfile",
            syntax_names: &["Dockerfile"],
            syntax_tokens: &["dockerfile"],
        },
        "graphql" | "gql" => LanguageDefinition {
            display_name: "GraphQL",
            syntax_names: &["GraphQL"],
            syntax_tokens: &["graphql", "gql"],
        },
        "text" | "txt" | "plain" | "plaintext" => LanguageDefinition {
            display_name: "Text",
            syntax_names: &["Plain Text"],
            syntax_tokens: &["txt", "text"],
        },
        _ => return None,
    };

    Some(definition)
}

pub(crate) fn highlight_code(code: &str, language: &LanguageDefinition) -> Option<String> {
    let syntax_set = syntax_set();
    let syntax = find_syntax(syntax_set, language)?;
    let mut generator = ClassedHTMLGenerator::new_with_class_style(
        syntax,
        syntax_set,
        ClassStyle::SpacedPrefixed { prefix: "syn-" },
    );

    for line in LinesWithEndings::from(code) {
        generator
            .parse_html_for_line_which_includes_newline(line)
            .ok()?;
    }

    Some(generator.finalize())
}

pub(crate) fn syntax_set() -> &'static SyntaxSet {
    static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAX_SET.get_or_init(two_face::syntax::extra_newlines)
}

pub(crate) fn find_syntax<'a>(
    syntax_set: &'a SyntaxSet,
    language: &LanguageDefinition,
) -> Option<&'a SyntaxReference> {
    language
        .syntax_names
        .iter()
        .find_map(|name| syntax_set.find_syntax_by_name(name))
        .or_else(|| {
            language
                .syntax_tokens
                .iter()
                .find_map(|token| syntax_set.find_syntax_by_token(token))
        })
}

pub(crate) fn safe_css_identifier(value: &str) -> String {
    value
        .chars()
        .filter_map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' {
                Some(char.to_ascii_lowercase())
            } else {
                None
            }
        })
        .collect::<String>()
}

pub(crate) fn repository_context(start: &Path) -> Option<RepositoryContext> {
    let mut current = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };

    loop {
        let git = current.join(".git");
        if git.exists() {
            return repository_context_from_git(&git);
        }

        if !current.pop() {
            return None;
        }
    }
}

pub(crate) fn repository_context_from_git(git_path: &Path) -> Option<RepositoryContext> {
    let config_paths = if git_path.is_file() {
        let git_file = fs::read_to_string(git_path).ok()?;
        let git_dir = git_file.trim().strip_prefix("gitdir:")?.trim();
        let git_dir = PathBuf::from(git_dir);
        let mut paths = vec![git_dir.join("config")];
        if let Ok(commondir) = fs::read_to_string(git_dir.join("commondir")) {
            let commondir = commondir.trim();
            let common_path = if Path::new(commondir).is_absolute() {
                PathBuf::from(commondir)
            } else {
                git_dir.join(commondir)
            };
            paths.push(common_path.join("config"));
        }
        paths
    } else {
        vec![git_path.join("config")]
    };

    config_paths.into_iter().find_map(|config_path| {
        let config = fs::read_to_string(config_path).ok()?;
        config
            .lines()
            .find_map(|line| line.trim().strip_prefix("url = "))
            .and_then(repository_context_from_remote_url)
    })
}

pub(crate) fn repository_context_from_remote_url(url: &str) -> Option<RepositoryContext> {
    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))?;
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    (!owner.is_empty() && !repo.is_empty()).then_some(RepositoryContext { owner, repo })
}

pub(crate) fn append_autolink_events(
    text: &str,
    finder: &LinkFinder,
    events: &mut Vec<Event<'static>>,
) {
    let mut offset = 0;

    for link in finder.links(text) {
        if link.start() > offset {
            events.push(Event::Text(cowstr(&text[offset..link.start()])));
        }

        let link_text = link.as_str();
        if let Some(destination) = autolink_destination(link_text, link.kind()) {
            events.push(Event::Start(Tag::Link {
                link_type: LinkType::Autolink,
                dest_url: cowstr(&destination),
                title: CowStr::Borrowed(""),
                id: CowStr::Borrowed(""),
            }));
            events.push(Event::Text(cowstr(link_text)));
            events.push(Event::End(TagEnd::Link));
        } else {
            events.push(Event::Text(cowstr(link_text)));
        }

        offset = link.end();
    }

    if offset < text.len() {
        events.push(Event::Text(cowstr(&text[offset..])));
    }
}

pub(crate) fn autolink_destination(text: &str, kind: &LinkKind) -> Option<String> {
    match kind {
        LinkKind::Email => Some(format!("mailto:{text}")),
        LinkKind::Url if starts_with_url_scheme(text) => Some(text.to_string()),
        LinkKind::Url if text.starts_with("www.") => Some(format!("http://{text}")),
        _ => None,
    }
}

pub(crate) fn starts_with_url_scheme(text: &str) -> bool {
    text.starts_with("http://") || text.starts_with("https://")
}

pub(crate) fn resolve_absolute_markdown_image_urls(
    events: Vec<Event<'static>>,
    source_path: &Path,
) -> Vec<Event<'static>> {
    events
        .into_iter()
        .map(|event| match event {
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) => {
                let resolved = markdown_image_destination_for_html(dest_url.as_ref(), source_path)
                    .map_or(dest_url, |url| cowstr(&url));

                Event::Start(Tag::Image {
                    link_type,
                    dest_url: resolved,
                    title,
                    id,
                })
            }
            _ => event,
        })
        .collect()
}

/// Copy an image's alt text into its `title` attribute when no explicit title
/// is set, so hovering the image shows the alt text as a native tooltip.
pub(crate) fn fill_image_titles_from_alt(events: Vec<Event<'static>>) -> Vec<Event<'static>> {
    let mut transformed: Vec<Event<'static>> = Vec::with_capacity(events.len());

    for (index, event) in events.iter().enumerate() {
        match event {
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) if title.is_empty() => {
                let alt = collect_image_alt_text(&events[index + 1..]);
                transformed.push(Event::Start(Tag::Image {
                    link_type: *link_type,
                    dest_url: dest_url.clone(),
                    title: cowstr(&alt),
                    id: id.clone(),
                }));
            }
            _ => transformed.push(event.clone()),
        }
    }

    transformed
}

/// Gather the plain text inside an image (its alt text) up to the closing image
/// tag. `events` starts just after the image's start tag.
pub(crate) fn collect_image_alt_text(events: &[Event<'static>]) -> String {
    let mut alt = String::new();

    for event in events {
        match event {
            Event::End(TagEnd::Image) => break,
            Event::Text(text) | Event::Code(text) => alt.push_str(text),
            _ => {}
        }
    }

    alt
}

pub(crate) fn markdown_image_destination_for_html(
    destination: &str,
    source_path: &Path,
) -> Option<String> {
    if let Some(badge_url) = github_actions_badge_fallback_url(destination) {
        return Some(badge_url);
    }

    let source_dir = local_image_source_dir(source_path)?;

    if Path::new(destination).is_absolute() {
        return local_image_relative_url_for_path(Path::new(destination), &source_dir);
    }

    if let Ok(url) = Url::parse(destination) {
        if url.scheme() == "file" {
            return url
                .to_file_path()
                .ok()
                .and_then(|path| local_image_relative_url_for_path(&path, &source_dir));
        }
    }

    None
}

pub(crate) fn github_actions_badge_fallback_url(destination: &str) -> Option<String> {
    let url = Url::parse(destination).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str() != Some("github.com") {
        return None;
    }

    let segments: Vec<&str> = url.path_segments()?.collect();
    let [owner, repo, "actions", "workflows", workflow, "badge.svg"] = segments.as_slice() else {
        return None;
    };

    let mut fallback = Url::parse("https://img.shields.io").ok()?;
    fallback.path_segments_mut().ok()?.extend([
        "github", "actions", "workflow", "status", owner, repo, workflow,
    ]);

    {
        let mut query = fallback.query_pairs_mut();
        query.append_pair("label", &github_actions_badge_label(workflow));
    }

    Some(fallback.to_string())
}

pub(crate) fn github_actions_badge_label(workflow: &str) -> String {
    let stem = workflow
        .strip_suffix(".yml")
        .or_else(|| workflow.strip_suffix(".yaml"))
        .unwrap_or(workflow);

    stem.split(['-', '_', '.'])
        .filter(|word| !word.is_empty())
        .map(|word| match word.to_ascii_lowercase().as_str() {
            "ci" => "CI".to_string(),
            "qemu" => "QEMU".to_string(),
            _ => {
                let mut chars = word.chars();
                chars
                    .next()
                    .map(|first| {
                        first
                            .to_uppercase()
                            .chain(chars.flat_map(char::to_lowercase))
                            .collect()
                    })
                    .unwrap_or_default()
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

pub(crate) fn resolve_image_destination(destination: &str, source_path: &Path) -> Option<String> {
    if destination.is_empty() || destination.starts_with('#') || destination.starts_with("//") {
        return None;
    }

    if let Some(url) = parse_image_destination_url(destination) {
        return match url.scheme() {
            "http" | "https" => Some(url.to_string()),
            "file" => url
                .to_file_path()
                .ok()
                .and_then(|path| local_image_url_for_absolute_path(&path, source_path)),
            _ => None,
        };
    }

    if Path::new(destination).is_absolute() {
        let path = local_image_destination_path(destination)?;
        return local_image_url_for_absolute_path(&path, source_path);
    }

    let source_dir = local_image_source_dir(source_path)?;

    local_image_protocol_url_for_relative_destination(destination, &source_dir)
}

/// Parse a destination as a URL, except when the "scheme" is a lone letter — that
/// is a Windows drive (`C:\imgs\pic.png`), which is a path, not a URL.
pub(crate) fn parse_image_destination_url(destination: &str) -> Option<Url> {
    let url = Url::parse(destination).ok()?;
    (url.scheme().len() > 1).then_some(url)
}

pub(crate) fn local_image_url_for_absolute_path(path: &Path, source_path: &Path) -> Option<String> {
    match local_image_source_dir(source_path) {
        Some(source_dir) => local_image_protocol_url_for_path(path, &source_dir),
        None => local_image_protocol_url_for_absolute_path(path),
    }
}

pub(crate) fn is_safe_relative_image_destination(destination: &str) -> bool {
    if destination.is_empty() || destination.starts_with('#') || destination.starts_with("//") {
        return false;
    }

    matches!(
        Url::parse(destination),
        Err(url::ParseError::RelativeUrlWithoutBase)
    )
}

pub fn local_image_source_dir(source_path: &Path) -> Option<PathBuf> {
    source_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(normalize_path_lexically)
}

pub(crate) fn local_image_protocol_url_for_relative_destination(
    destination: &str,
    source_dir: &Path,
) -> Option<String> {
    let path = local_image_destination_path(destination)?;
    if path.is_absolute() {
        return local_image_protocol_url_for_path(&path, source_dir);
    }

    local_image_protocol_url_for_relative_path(&path, source_dir)
}

pub(crate) fn local_image_destination_path(destination: &str) -> Option<PathBuf> {
    let path = destination.split(['#', '?']).next().unwrap_or(destination);
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(percent_decode_path(path)))
}

pub(crate) fn local_image_protocol_url_for_path(path: &Path, source_dir: &Path) -> Option<String> {
    let normalized_path = normalize_path_lexically(path);
    let normalized_source_dir = normalize_path_lexically(source_dir);

    match normalized_path.strip_prefix(&normalized_source_dir) {
        Ok(relative) => {
            local_image_protocol_url_for_relative_path(relative, &normalized_source_dir)
        }
        // Anywhere else on disk: carry the whole path in the URL.
        Err(_) => local_image_protocol_url_for_absolute_path(&normalized_path),
    }
}

pub(crate) fn local_image_protocol_url_for_absolute_path(path: &Path) -> Option<String> {
    let path = path.to_str()?;
    if path.is_empty() {
        return None;
    }

    Some(local_image_webview_url(&format!(
        "{LOCAL_IMAGE_ABSOLUTE_SEGMENT}/{}",
        percent_encode_url_path_segment(path)
    )))
}

pub(crate) fn local_image_relative_url_for_path(path: &Path, source_dir: &Path) -> Option<String> {
    let normalized_path = normalize_path_lexically(path);
    let normalized_source_dir = normalize_path_lexically(source_dir);
    let relative = normalized_path.strip_prefix(&normalized_source_dir).ok()?;

    local_image_relative_url(relative)
}

pub(crate) fn local_image_protocol_url_for_relative_path(
    relative_path: &Path,
    _source_dir: &Path,
) -> Option<String> {
    let mut segments = Vec::new();

    for component in relative_path.components() {
        match component {
            std::path::Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.is_empty() {
                    return None;
                }
                segments.push(percent_encode_url_path_segment(&segment));
            }
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                segments.push(LOCAL_IMAGE_PARENT_SEGMENT.to_string())
            }
            _ => return None,
        }
    }

    (!segments.is_empty()).then(|| local_image_webview_url(&segments.join("/")))
}

pub(crate) fn local_image_relative_url(relative_path: &Path) -> Option<String> {
    let relative_path = normalize_path_lexically(relative_path);
    let mut segments = Vec::new();

    for component in relative_path.components() {
        match component {
            std::path::Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.is_empty() {
                    return None;
                }
                segments.push(percent_encode_url_path_segment(&segment));
            }
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }

    (!segments.is_empty()).then(|| segments.join("/"))
}

pub fn local_image_protocol_response(uri: &str, source_dir: Option<&Path>) -> LocalImageResponse {
    let Some(source_dir) = source_dir else {
        return empty_local_image_response(404);
    };
    let Some(path) = local_image_protocol_path(uri, source_dir) else {
        return empty_local_image_response(404);
    };

    match fs::read(&path) {
        Ok(body) => LocalImageResponse {
            status: 200,
            content_type: local_image_mime_type(&path),
            body,
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => empty_local_image_response(404),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            empty_local_image_response(403)
        }
        Err(_) => empty_local_image_response(500),
    }
}

pub(crate) fn local_image_protocol_path(uri: &str, source_dir: &Path) -> Option<PathBuf> {
    let url = Url::parse(uri).ok()?;
    if !is_local_image_request_url(&url) {
        return None;
    }

    let mut segments = url.path_segments()?.filter(|segment| !segment.is_empty());

    // `__leaf_absolute__/<encoded path>`: the path stands on its own.
    let mut relative = PathBuf::new();
    for segment in segments.by_ref() {
        let decoded = percent_decode_path(segment);
        if decoded == LOCAL_IMAGE_ABSOLUTE_SEGMENT && relative.as_os_str().is_empty() {
            let absolute = PathBuf::from(percent_decode_path(segments.next()?));
            return (!absolute.as_os_str().is_empty()).then(|| normalize_path_lexically(&absolute));
        }
        if decoded == LOCAL_IMAGE_PARENT_SEGMENT {
            relative.push("..");
            continue;
        }
        if decoded.is_empty() || decoded == "." || decoded == ".." {
            return None;
        }
        relative.push(decoded);
    }
    if relative.as_os_str().is_empty() {
        return None;
    }

    Some(normalize_path_lexically(&source_dir.join(relative)))
}

pub(crate) fn is_local_image_request_url(url: &Url) -> bool {
    if url.scheme() == LOCAL_IMAGE_PROTOCOL {
        return url.host_str() == Some(LOCAL_IMAGE_HOST);
    }

    matches!(url.scheme(), "http" | "https")
        && url
            .host_str()
            .and_then(|host| host.strip_prefix(&format!("{LOCAL_IMAGE_PROTOCOL}.")))
            == Some(LOCAL_IMAGE_HOST)
}

pub(crate) fn local_image_webview_url(path: &str) -> String {
    let protocol_url = format!("{LOCAL_IMAGE_PROTOCOL}://{LOCAL_IMAGE_HOST}/{path}");
    local_image_webview_url_from_protocol_url(&protocol_url)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) fn local_image_webview_url_from_protocol_url(url: &str) -> String {
    url.replacen(
        &format!("{LOCAL_IMAGE_PROTOCOL}://"),
        &format!("http://{LOCAL_IMAGE_PROTOCOL}."),
        1,
    )
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub(crate) fn local_image_webview_url_from_protocol_url(url: &str) -> String {
    url.to_string()
}

pub(crate) fn empty_local_image_response(status: u16) -> LocalImageResponse {
    LocalImageResponse {
        status,
        content_type: "text/plain; charset=utf-8",
        body: Vec::new(),
    }
}

/// True when `path` names a file the reading view displays as an image, so live
/// reload refreshes the images in place instead of re-rendering.
pub fn is_local_image_path(path: &Path) -> bool {
    local_image_mime_type(path).starts_with("image/")
}

pub(crate) fn local_image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("apng") => "image/apng",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

pub(crate) fn percent_encode_url_path_segment(segment: &str) -> String {
    if segment == "." {
        return "%2E".to_string();
    }
    if segment == ".." {
        return "%2E%2E".to_string();
    }

    let mut encoded = String::with_capacity(segment.len());
    for byte in segment.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

pub(crate) fn percent_decode_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(value) = hex_pair(bytes[index + 1], bytes[index + 2]) {
                decoded.push(value);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8(decoded)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
}

pub(crate) fn hex_pair(high: u8, low: u8) -> Option<u8> {
    Some(hex_value(high)? << 4 | hex_value(low)?)
}

pub(crate) fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

pub(crate) fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

pub(crate) fn resolve_rendered_html_image_urls(html: &str, source_path: &Path) -> String {
    let mut resolved = String::with_capacity(html.len());
    let mut offset = 0usize;
    let lower_html = html.to_ascii_lowercase();

    while let Some(relative_start) = lower_html[offset..].find("<img") {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            break;
        };

        resolved.push_str(&html[offset..tag_start]);
        resolved.push_str(&resolve_img_tag_src(&html[tag_start..tag_end], source_path));
        offset = tag_end;
    }

    resolved.push_str(&html[offset..]);
    resolved
}

pub(crate) fn sanitize_raw_markdown_html_fragment(html: &str) -> String {
    let mut sanitized = String::with_capacity(html.len());
    let mut offset = 0usize;
    let lower_html = html.to_ascii_lowercase();

    while let Some(relative_start) = html[offset..].find('<') {
        let tag_start = offset + relative_start;
        sanitized.push_str(&html[offset..tag_start]);

        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            sanitized.push_str(&encode_text(&html[tag_start..]));
            return sanitized;
        };

        let tag = &html[tag_start..tag_end];
        if let Some(tag_name) = html_tag_name(tag) {
            if matches!(tag_name.as_str(), "script" | "style") && !is_html_closing_tag(tag) {
                if let Some(close_start) = lower_html[tag_end..].find(&format!("</{tag_name}")) {
                    if let Some(close_end) = find_html_tag_end(html, tag_end + close_start) {
                        offset = close_end;
                        continue;
                    }
                }
                return sanitized;
            }
        }

        sanitized.push_str(&sanitize_raw_markdown_html_tag(tag));
        offset = tag_end;
    }

    sanitized.push_str(&html[offset..]);
    sanitized
}

pub(crate) fn opens_unclosed_raw_html_content_tag(html: &str) -> Option<&'static str> {
    ["script", "style"].into_iter().find(|tag_name| {
        opens_raw_html_content_tag(html, tag_name) && !closes_raw_html_content_tag(html, tag_name)
    })
}

pub(crate) fn opens_raw_html_content_tag(html: &str, tag_name: &str) -> bool {
    let lower_html = html.to_ascii_lowercase();
    let mut offset = 0usize;
    while let Some(relative_start) = lower_html[offset..].find(&format!("<{tag_name}")) {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            return true;
        };
        if html_tag_name(&html[tag_start..tag_end]).as_deref() == Some(tag_name) {
            return true;
        }
        offset = tag_end;
    }
    false
}

pub(crate) fn closes_raw_html_content_tag(html: &str, tag_name: &str) -> bool {
    let lower_html = html.to_ascii_lowercase();
    let mut offset = 0usize;
    while let Some(relative_start) = lower_html[offset..].find(&format!("</{tag_name}")) {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(html, tag_start) else {
            return true;
        };
        if html_tag_name(&html[tag_start..tag_end]).as_deref() == Some(tag_name) {
            return true;
        }
        offset = tag_end;
    }
    false
}

pub(crate) fn sanitize_raw_markdown_html_tag(tag: &str) -> String {
    let Some(tag_name) = html_tag_name(tag) else {
        return String::new();
    };

    if !is_allowed_raw_markdown_html_tag(&tag_name) {
        return String::new();
    }

    if is_html_closing_tag(tag) {
        return format!("</{tag_name}>");
    }

    let mut sanitized = String::from("<");
    sanitized.push_str(&tag_name);

    for attribute_name in allowed_raw_markdown_html_attributes(&tag_name) {
        let Some(attribute) = find_html_attribute(tag, attribute_name) else {
            continue;
        };
        let Some(attribute_value) =
            sanitized_raw_markdown_html_attribute_value(attribute_name, attribute.value)
        else {
            continue;
        };
        sanitized.push(' ');
        sanitized.push_str(attribute_name);
        sanitized.push_str("=\"");
        sanitized.push_str(&encode_double_quoted_attribute(&attribute_value));
        sanitized.push('"');
    }

    // Boolean attributes (e.g. `<details open>`) carry no value; emit them bare
    // when present so a collapsible block keeps its expanded state.
    for attribute_name in allowed_raw_markdown_html_boolean_attributes(&tag_name) {
        if html_has_boolean_attribute(tag, attribute_name) {
            sanitized.push(' ');
            sanitized.push_str(attribute_name);
        }
    }

    if is_html_self_closing_tag(tag) {
        sanitized.push_str(" />");
    } else {
        sanitized.push('>');
    }

    sanitized
}

pub(crate) fn html_tag_name(tag: &str) -> Option<String> {
    let mut index = 1usize;
    if tag.as_bytes().get(index).copied() == Some(b'/') {
        index += 1;
    }
    index = skip_html_whitespace(tag, index);
    let name_start = index;
    while index < tag.len() {
        let character = tag[index..].chars().next()?;
        if !(character.is_ascii_alphanumeric() || matches!(character, '-' | ':')) {
            break;
        }
        index += character.len_utf8();
    }
    (index > name_start).then(|| tag[name_start..index].to_ascii_lowercase())
}

pub(crate) fn is_html_closing_tag(tag: &str) -> bool {
    tag[1..].trim_start().starts_with('/')
}

pub(crate) fn is_html_self_closing_tag(tag: &str) -> bool {
    tag[..tag.len().saturating_sub(1)].trim_end().ends_with('/')
}

pub(crate) fn is_allowed_raw_markdown_html_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "p" | "br"
            | "hr"
            | "a"
            | "strong"
            | "em"
            | "del"
            | "code"
            | "pre"
            | "img"
            | "ul"
            | "ol"
            | "li"
            | "blockquote"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "div"
            | "span"
            | "table"
            | "thead"
            | "tbody"
            | "tr"
            | "td"
            | "th"
            // Collapsible sections, common in GitHub READMEs.
            | "details"
            | "summary"
            // Safe semantic/formatting inline elements (no scripting or loads).
            | "kbd"
            | "sub"
            | "sup"
            | "mark"
            | "ins"
            | "s"
            | "abbr"
            | "dl"
            | "dt"
            | "dd"
            | "figure"
            | "figcaption"
    )
}

pub(crate) fn allowed_raw_markdown_html_attributes(tag_name: &str) -> &'static [&'static str] {
    match tag_name {
        "a" => &["href", "title", "id", "name"],
        "img" => &["src", "alt", "title"],
        "div" | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => &["align", "id"],
        "span" => &["id"],
        "td" | "th" => &["align", "colspan"],
        "abbr" => &["title"],
        _ => &[],
    }
}

/// Boolean attributes kept when present (e.g. `open` on `<details>`), emitted bare.
pub(crate) fn allowed_raw_markdown_html_boolean_attributes(
    tag_name: &str,
) -> &'static [&'static str] {
    match tag_name {
        "details" => &["open"],
        _ => &[],
    }
}

/// Whether `tag` carries `attribute_name`, with or without a value. Tokenizes
/// like [`find_html_attribute`] so a substring inside another attribute's value
/// (e.g. `title="open sesame"`) doesn't false-positive.
pub(crate) fn html_has_boolean_attribute(tag: &str, attribute_name: &str) -> bool {
    let mut index = tag.find(char::is_whitespace).unwrap_or(tag.len());

    while index < tag.len() {
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() || tag[index..].starts_with('>') || tag[index..].starts_with("/>") {
            break;
        }

        let name_start = index;
        while index < tag.len() {
            let Some(character) = tag[index..].chars().next() else {
                break;
            };
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.') {
                index += character.len_utf8();
            } else {
                break;
            }
        }
        if name_start == index {
            let Some(character) = tag[index..].chars().next() else {
                break;
            };
            index += character.len_utf8();
            continue;
        }
        let name = &tag[name_start..index];
        index = skip_html_whitespace(tag, index);

        // Skip any `="value"` so the scan stays aligned on the next name.
        if tag[index..].starts_with('=') {
            index += 1;
            index = skip_html_whitespace(tag, index);
            if let Some(first) = tag[index..].chars().next() {
                if first == '"' || first == '\'' {
                    index += first.len_utf8();
                    while index < tag.len() {
                        let Some(character) = tag[index..].chars().next() else {
                            break;
                        };
                        index += character.len_utf8();
                        if character == first {
                            break;
                        }
                    }
                } else {
                    while index < tag.len() {
                        let Some(character) = tag[index..].chars().next() else {
                            break;
                        };
                        if character.is_whitespace() || character == '>' {
                            break;
                        }
                        index += character.len_utf8();
                    }
                }
            }
        }

        if name.eq_ignore_ascii_case(attribute_name) {
            return true;
        }
    }

    false
}

pub(crate) fn sanitized_raw_markdown_html_attribute_value(
    attribute_name: &str,
    value: &str,
) -> Option<String> {
    match attribute_name {
        "href" | "src" => is_safe_raw_markdown_html_url(value).then(|| value.to_string()),
        "align" => sanitize_raw_markdown_html_align_value(value),
        _ => Some(value.to_string()),
    }
}

pub(crate) fn sanitize_raw_markdown_html_align_value(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    matches!(normalized.as_str(), "left" | "center" | "right" | "justify").then_some(normalized)
}

pub(crate) fn is_safe_raw_markdown_html_url(value: &str) -> bool {
    match Url::parse(value) {
        Ok(url) => matches!(url.scheme(), "http" | "https" | "mailto" | "file"),
        Err(url::ParseError::RelativeUrlWithoutBase) => true,
        Err(_) => false,
    }
}

pub(crate) fn find_html_tag_end(html: &str, tag_start: usize) -> Option<usize> {
    let mut quote = None;

    for (relative_index, character) in html[tag_start..].char_indices() {
        match (quote, character) {
            (Some(active_quote), current) if current == active_quote => quote = None,
            (None, '"' | '\'') => quote = Some(character),
            (None, '>') => return Some(tag_start + relative_index + character.len_utf8()),
            _ => {}
        }
    }

    None
}

pub(crate) fn resolve_img_tag_src(tag: &str, source_path: &Path) -> String {
    let Some(attribute) = find_html_attribute(tag, "src") else {
        return tag.to_string();
    };
    if local_image_source_dir(source_path).is_none()
        && is_safe_relative_image_destination(attribute.value)
    {
        return tag.to_string();
    }
    let resolved_src = resolve_image_destination(attribute.value, source_path)
        .unwrap_or_else(|| "javascript:leaf-blocked".to_string());

    let mut resolved = String::with_capacity(tag.len() + resolved_src.len());
    resolved.push_str(&tag[..attribute.replacement_start]);
    if attribute.was_quoted {
        resolved.push_str(&encode_double_quoted_attribute(&resolved_src));
    } else {
        resolved.push('"');
        resolved.push_str(&encode_double_quoted_attribute(&resolved_src));
        resolved.push('"');
    }
    resolved.push_str(&tag[attribute.replacement_end..]);
    resolved
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct HtmlAttribute<'a> {
    value: &'a str,
    replacement_start: usize,
    replacement_end: usize,
    was_quoted: bool,
}

pub(crate) fn find_html_attribute<'a>(
    tag: &'a str,
    attribute_name: &str,
) -> Option<HtmlAttribute<'a>> {
    let mut index = tag.find(char::is_whitespace).unwrap_or(tag.len());

    while index < tag.len() {
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() || tag[index..].starts_with('>') || tag[index..].starts_with("/>") {
            break;
        }

        let name_start = index;
        while index < tag.len() {
            let character = tag[index..].chars().next()?;
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.') {
                index += character.len_utf8();
            } else {
                break;
            }
        }
        if name_start == index {
            index += tag[index..].chars().next()?.len_utf8();
            continue;
        }
        let name = &tag[name_start..index];
        index = skip_html_whitespace(tag, index);

        if !tag[index..].starts_with('=') {
            continue;
        }

        index += 1;
        index = skip_html_whitespace(tag, index);
        if index >= tag.len() {
            break;
        }

        let value_start;
        let value_end;
        let was_quoted;
        let first = tag[index..].chars().next()?;
        if first == '"' || first == '\'' {
            was_quoted = true;
            index += first.len_utf8();
            value_start = index;
            while index < tag.len() {
                let character = tag[index..].chars().next()?;
                if character == first {
                    break;
                }
                index += character.len_utf8();
            }
            value_end = index;
            if index < tag.len() {
                index += first.len_utf8();
            }
        } else {
            was_quoted = false;
            value_start = index;
            while index < tag.len() {
                let character = tag[index..].chars().next()?;
                if character.is_whitespace() || character == '>' {
                    break;
                }
                index += character.len_utf8();
            }
            value_end = index;
        }

        if name.eq_ignore_ascii_case(attribute_name) {
            return Some(HtmlAttribute {
                value: &tag[value_start..value_end],
                replacement_start: value_start,
                replacement_end: value_end,
                was_quoted,
            });
        }
    }

    None
}

pub(crate) fn skip_html_whitespace(text: &str, mut index: usize) -> usize {
    while index < text.len() {
        let Some(character) = text[index..].chars().next() else {
            break;
        };
        if !character.is_whitespace() {
            break;
        }
        index += character.len_utf8();
    }
    index
}

pub(crate) fn cowstr(value: &str) -> CowStr<'static> {
    CowStr::Boxed(value.to_string().into_boxed_str())
}

pub(crate) fn sanitize_rendered_html(html: &str) -> String {
    let mut sanitizer = Builder::new();
    configure_rendered_html_sanitizer(&mut sanitizer);
    sanitizer.clean(html).to_string()
}

pub(crate) fn configure_rendered_html_sanitizer(sanitizer: &mut Builder<'_>) {
    sanitizer
        .url_schemes(
            ["http", "https", "mailto", "glossary", LOCAL_IMAGE_PROTOCOL]
                .into_iter()
                .collect(),
        )
        .add_tags(&["input"])
        .add_tag_attributes("a", &["aria-label", "class", "id", "name"])
        .add_tag_attributes("blockquote", &["class"])
        .add_tag_attributes("div", &["align", "class", "id"])
        .add_tag_attributes("code", &["class"])
        .add_tag_attributes("abbr", &["title"])
        .add_tag_attributes("details", &["open"])
        .add_tag_attributes("h1", &["align", "id"])
        .add_tag_attributes("h2", &["align", "id"])
        .add_tag_attributes("h3", &["align", "id"])
        .add_tag_attributes("h4", &["align", "id"])
        .add_tag_attributes("h5", &["align", "id"])
        .add_tag_attributes("h6", &["align", "id"])
        .add_tag_attributes("img", &["alt", "src", "title"])
        .add_tag_attributes("p", &["align", "id"])
        .add_tag_attributes("pre", &["class", "data-language"])
        .add_tag_attributes("span", &["aria-label", "class", "id", "title"])
        .add_tag_attributes("sup", &["class", "id"])
        .add_tags(&["svg", "path"])
        .add_tag_attributes("svg", &["aria-hidden", "focusable", "viewBox", "xmlns"])
        .add_tag_attributes(
            "path",
            &[
                "d",
                "fill",
                "stroke",
                "stroke-linecap",
                "stroke-linejoin",
                "stroke-width",
            ],
        )
        .add_tag_attributes("input", &["checked", "disabled", "type"])
        .add_tag_attributes("td", &["align", "colspan"])
        .add_tag_attributes("th", &["align", "colspan"])
        // Editing-model block markers (`data-leaf-*`, `data-src-*`): no script,
        // never a URL context, so allowed on every tag.
        .add_generic_attribute_prefixes(&["data-leaf-", "data-src-"]);
}

pub(crate) fn markdown_title(markdown: &str) -> Option<String> {
    let events = parse_markdown_source(markdown, MarkdownParserConfig::github_flavored());
    markdown_heading_title(&events).or_else(|| raw_html_block_title(&events))
}

pub(crate) fn markdown_heading_title(events: &[Event<'static>]) -> Option<String> {
    let mut heading_text = String::new();
    let mut in_heading = false;

    for event in events {
        match event {
            Event::Start(Tag::Heading { .. }) => {
                in_heading = true;
                heading_text.clear();
            }
            Event::End(TagEnd::Heading(_)) if in_heading => {
                if let Some(title) = plain_document_title(&heading_text) {
                    return Some(title);
                }
                in_heading = false;
            }
            _ if in_heading => append_title_text(event, &mut heading_text),
            _ => {}
        }
    }

    None
}

pub(crate) fn raw_html_block_title(events: &[Event<'static>]) -> Option<String> {
    events.iter().find_map(|event| {
        if let Event::Html(html) | Event::InlineHtml(html) = event {
            plain_document_title_from_html(html.as_ref())
        } else {
            None
        }
    })
}

pub(crate) fn append_title_text(event: &Event<'_>, text: &mut String) {
    match event {
        Event::Text(value) | Event::Code(value) => text.push_str(value.as_ref()),
        Event::InlineHtml(value) | Event::Html(value) => {
            text.push_str(&strip_html_tags(value.as_ref()));
        }
        Event::SoftBreak | Event::HardBreak => text.push(' '),
        _ => {}
    }
}

pub(crate) fn plain_document_title_from_html(value: &str) -> Option<String> {
    let stripped = strip_html_tags(value);
    plain_document_title(&stripped)
}

pub(crate) fn plain_document_title(value: &str) -> Option<String> {
    let decoded = decode_html_entities(value);
    let normalized = normalize_title_whitespace(decoded.as_ref());
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

pub(crate) fn normalize_title_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
