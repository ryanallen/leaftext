//! Raw Markdown source, colored for the code view.
//!
//! syntect's Markdown grammar costs seconds where pulldown-cmark reads the same
//! bytes with offsets in milliseconds (4.7s against 13ms on a 4MB glossary, and it
//! is worse on dense files), so the colors come from the parse the reading view
//! already does. The other formats and fenced code still use syntect.
//!
//! Every byte no event claims is a delimiter of the construct it sits in — that one
//! rule covers `#`, `*`, backticks, `[`/`]`, `>`, list markers and table pipes
//! without a scanner for each.

use std::ops::Range;

use super::*;

/// What a construct contributes to the bytes inside it.
#[derive(Clone, Copy, Default)]
struct Paint {
    /// Carried by every byte in the construct, nested ones included.
    body: u64,
    /// Carried by unclaimed bytes — the construct's own punctuation. Zero means it
    /// owns none, so a gap falls through to whatever encloses it.
    delimiter: u64,
    /// Carried by text directly inside it, on top of `body`.
    leaf: u64,
}

/// Constructs whose delimiters are more than one run.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shape {
    /// The whole gap is punctuation.
    Plain,
    /// `## `, `- ` — the marker is punctuation, the space after it is not.
    Marker,
    /// `[`, `](url)` — brackets are punctuation, the destination is a link.
    LinkTail,
    /// ```` ```lang ```` — the backticks are punctuation, the info string a constant.
    Fence,
}

struct Frame {
    paint: Paint,
    shape: Shape,
    end: usize,
}

fn construct(body: &[&str], delimiter: &[&str], leaf: &[&str]) -> Paint {
    Paint {
        body: atom_bits(body),
        delimiter: atom_bits(delimiter),
        leaf: atom_bits(leaf),
    }
}

/// What `Start(tag)` contributes, and whether its delimiters need splitting.
fn paint_for_tag(tag: &Tag<'_>) -> (Paint, Shape) {
    let markup =
        |kind: &str| construct(&["markup", kind], &["punctuation", "definition", kind], &[]);
    match tag {
        Tag::Heading { .. } => (
            construct(
                &["markup", "heading"],
                &["punctuation", "definition", "heading"],
                &["entity", "name", "section"],
            ),
            Shape::Marker,
        ),
        Tag::Strong => (markup("bold"), Shape::Plain),
        Tag::Emphasis => (markup("italic"), Shape::Plain),
        Tag::Strikethrough => (markup("strikethrough"), Shape::Plain),
        Tag::BlockQuote(_) => (markup("quote"), Shape::Plain),
        Tag::CodeBlock(_) => (markup("raw"), Shape::Fence),
        Tag::Link { .. } => (
            construct(
                &["meta", "link"],
                &["punctuation", "definition", "link"],
                &[],
            ),
            Shape::LinkTail,
        ),
        Tag::Image { .. } => (
            construct(
                &["meta", "link"],
                &["punctuation", "definition", "image"],
                &[],
            ),
            Shape::LinkTail,
        ),
        Tag::FootnoteDefinition(_) => (
            construct(
                &["meta", "link"],
                &["punctuation", "definition", "link"],
                &[],
            ),
            Shape::Plain,
        ),
        Tag::Item => (
            construct(&[], &["punctuation", "list_item"], &[]),
            Shape::Marker,
        ),
        // A table's pipes and its delimiter row are the gaps around its cells.
        Tag::Table(_) | Tag::TableHead | Tag::TableRow | Tag::TableCell => {
            (construct(&[], &["punctuation"], &[]), Shape::Plain)
        }
        // List, Paragraph, HtmlBlock and the rest own nothing, so their gaps fall
        // through to whatever encloses them.
        _ => (Paint::default(), Shape::Plain),
    }
}

impl Frame {
    /// A construct carries what encloses it, so a bold word inside a link is both.
    fn inherit(mut paint: Paint, stack: &[Frame]) -> Paint {
        if let Some(parent) = stack.last() {
            paint.body |= parent.paint.body;
            paint.delimiter = if paint.delimiter == 0 {
                parent.paint.delimiter
            } else {
                paint.delimiter | parent.paint.body
            };
        }
        paint
    }
}

/// Color `source` as Markdown: one span per run of identically-styled text, in the
/// class vocabulary `highlight_code` emits and the stylesheet already matches.
pub(crate) fn color_markdown_source(source: &str) -> String {
    let mut writer = SourceWriter::new(source);
    let mut stack: Vec<Frame> = Vec::new();

    for (event, range) in Parser::new_ext(source, markdown_options()).into_offset_iter() {
        match event {
            Event::Start(tag) => {
                writer.gap_up_to(range.start, &stack);
                let (paint, shape) = paint_for_tag(&tag);
                let paint = Frame::inherit(paint, &stack);
                if let Tag::CodeBlock(kind) = &tag {
                    // Written whole here — the body is highlighted as its own
                    // language, which the event stream cannot express.
                    writer.write_code_block(&range, kind, paint);
                }
                stack.push(Frame {
                    paint,
                    shape,
                    end: range.end,
                });
            }
            Event::End(_) => {
                if let Some(frame) = stack.pop() {
                    writer.gap_up_to_with(frame.end, frame.paint, frame.shape);
                }
            }
            Event::Code(_) => {
                writer.gap_up_to(range.start, &stack);
                let paint = Frame::inherit(
                    construct(
                        &["markup", "raw"],
                        &["punctuation", "definition", "raw"],
                        &[],
                    ),
                    &stack,
                );
                writer.write_code_span(&range, paint);
            }
            _ => {
                writer.gap_up_to(range.start, &stack);
                let paint = stack.last().map(|frame| frame.paint).unwrap_or_default();
                writer.write(range.start, range.end, paint.body | paint.leaf);
            }
        }
    }
    writer.gap_up_to(source.len(), &stack);
    writer.finish()
}

/// Emits the color layer in source order. Everything is clamped to `cursor`, so a
/// range already written — a code block written whole, or an overlapping range from
/// the parser — is skipped rather than duplicated.
struct SourceWriter<'a> {
    source: &'a str,
    html: String,
    cursor: usize,
    open: String,
    wanted: String,
    classes: HashMap<u64, String>,
}

impl<'a> SourceWriter<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            html: String::with_capacity(source.len() * 2),
            cursor: 0,
            open: String::new(),
            wanted: String::new(),
            classes: HashMap::new(),
        }
    }

    /// Write `start..end` carrying `atoms`, breaking spans at every newline and
    /// leaving the newline outside them — the code view splits this per source line.
    fn write(&mut self, start: usize, end: usize, atoms: u64) {
        let start = start.max(self.cursor);
        if end <= start {
            return;
        }
        let list = self
            .classes
            .entry(atoms)
            .or_insert_with(|| styled_class_list(atoms));
        self.wanted.clear();
        self.wanted.push_str(list);

        let mut at = start;
        for (offset, _) in self.source[start..end].match_indices('\n') {
            let line_end = start + offset;
            push_run(
                &mut self.html,
                &mut self.open,
                &self.wanted,
                &self.source[at..line_end],
            );
            self.close_span();
            self.html.push('\n');
            at = line_end + 1;
        }
        push_run(
            &mut self.html,
            &mut self.open,
            &self.wanted,
            &self.source[at..end],
        );
        self.cursor = end;
    }

    fn close_span(&mut self) {
        if !self.open.is_empty() {
            self.html.push_str("</span>");
            self.open.clear();
        }
    }

    /// Everything between the cursor and `up_to` belongs to the innermost enclosing
    /// construct's delimiters.
    fn gap_up_to(&mut self, up_to: usize, stack: &[Frame]) {
        let (paint, shape) = stack
            .last()
            .map(|frame| (frame.paint, frame.shape))
            .unwrap_or((Paint::default(), Shape::Plain));
        self.gap_up_to_with(up_to, paint, shape);
    }

    fn gap_up_to_with(&mut self, up_to: usize, paint: Paint, shape: Shape) {
        let start = self.cursor;
        if up_to <= start {
            return;
        }
        match shape {
            Shape::Plain => self.write(start, up_to, paint.delimiter | paint.body),
            Shape::Marker => {
                // The marker itself, then whatever spacing follows it.
                let text = &self.source[start..up_to];
                let marker =
                    text.len() - text.trim_start_matches(|c: char| !c.is_whitespace()).len();
                self.write(start, start + marker, paint.delimiter | paint.body);
                self.write(start + marker, up_to, paint.body);
            }
            Shape::LinkTail => {
                let label = paint.delimiter | paint.body;
                let around_destination =
                    paint.body | atom_bits(&["punctuation", "definition", "metadata"]);
                let destination = paint.body | atom_bits(&["markup", "underline", "link"]);
                self.split_gap(start, up_to, |char| match char {
                    // `!` opens an image, so it goes with the label's brackets.
                    '!' | '[' | ']' => label,
                    '(' | ')' => around_destination,
                    _ => destination,
                });
            }
            Shape::Fence => {
                let info = paint.body | atom_bits(&["constant"]);
                let delimiter = paint.delimiter | paint.body;
                self.split_gap(start, up_to, |char| match char {
                    '`' | '~' => delimiter,
                    _ => info,
                });
            }
        }
    }

    /// A gap whose parts differ: `classify` gives each character its atoms, and
    /// neighbours that agree become one run.
    fn split_gap(&mut self, start: usize, up_to: usize, classify: impl Fn(char) -> u64) {
        let mut at = start;
        while at < up_to {
            let rest = &self.source[at..up_to];
            let atoms = classify(rest.chars().next().expect("non-empty"));
            let run: usize = rest
                .chars()
                .take_while(|char| classify(*char) == atoms)
                .map(char::len_utf8)
                .sum();
            self.write(at, at + run, atoms);
            at += run;
        }
    }

    /// A code span covers its own backticks, so peel them off the content.
    fn write_code_span(&mut self, range: &Range<usize>, paint: Paint) {
        let text = &self.source[range.clone()];
        let ticks = text.len() - text.trim_start_matches('`').len();
        self.write(
            range.start,
            range.start + ticks,
            paint.delimiter | paint.body,
        );
        self.write(range.start + ticks, range.end - ticks, paint.body);
        self.write(range.end - ticks, range.end, paint.delimiter | paint.body);
    }

    /// The fence lines as punctuation, and the body highlighted as its own language
    /// where we have one — a Rust fence in a Markdown file reads as Rust, the way it
    /// does in the reading view.
    fn write_code_block(&mut self, range: &Range<usize>, kind: &CodeBlockKind<'_>, paint: Paint) {
        let CodeBlockKind::Fenced(language) = kind else {
            // Indented block: no fence to color, and the body is plain.
            return;
        };
        let Some(body) = fence_body(self.source, range) else {
            return;
        };
        self.gap_up_to_with(body.start, paint, Shape::Fence);

        let highlighted = language
            .split_whitespace()
            .next()
            .and_then(language_definition)
            .and_then(|definition| highlight_code(&self.source[body.clone()], &definition));
        match highlighted {
            Some(markup) => {
                self.close_span();
                self.html.push_str(&markup);
                self.cursor = body.end;
            }
            None => self.write(body.start, body.end, paint.body),
        }
        self.gap_up_to_with(range.end, paint, Shape::Fence);
    }

    fn finish(mut self) -> String {
        // Through `write` rather than pushed raw: anything left is still source text
        // and has to be escaped.
        self.write(self.cursor, self.source.len(), 0);
        self.close_span();
        self.html
    }
}

/// The bytes between a fence's opening and closing lines, ending on the newline
/// that closes the last body line. `None` when the fence holds no body, so the
/// caller leaves the whole block to the generic delimiter path.
fn fence_body(source: &str, range: &Range<usize>) -> Option<Range<usize>> {
    let body_start = range.start + source[range.clone()].find('\n')? + 1;
    let body_end = body_start + source[body_start..range.end].rfind('\n')? + 1;
    (body_start < body_end).then_some(body_start..body_end)
}
