//! Footnotes: collecting definitions and linking back to the reference.

use super::*;

/// Move every footnote definition to the end of the document in reference order (unreferenced ones trailing in source order), mirroring GitHub. Emitting them in reference order also lines up pulldown-cmark's printed labels with the superscript numbers, since its HTML writer labels by emission order.
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

#[derive(Debug, Default)]
pub(crate) struct FootnoteTracker {
    pub(crate) numbers: HashMap<String, usize>,
}

impl FootnoteTracker {
    pub(crate) fn render_reference(&mut self, name: &str) -> String {
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
    pub(crate) fn number_of(&self, name: &str) -> Option<usize> {
        self.numbers.get(name).copied()
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
