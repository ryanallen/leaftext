//! PowerPoint decks. `ppt/presentation.xml` holds the slide order and points at one member per slide.
//!
//! **A deck reads as one entry per slide, headed by the slide's own title**, rather than as one flat list of titles, which loses every word that is not one. A slide with no title placeholder is headed by its number, so the outline never skips a slide somebody has to scroll past.
//!
//! Text on a slide sits in shapes: `p:sp > p:txBody > a:p > a:r > a:t`, and which shape is the title is written on the shape rather than guessed from its position.

use super::*;

const PRESENTATION: &str = "ppt/presentation.xml";
const PRESENTATION_RELATIONSHIPS: &str = "ppt/_rels/presentation.xml.rels";

pub(super) fn read(archive: &Archive<'_>) -> Result<OfficeDocument, ArchiveError> {
    let presentation_text = archive.member_text(PRESENTATION).ok_or_else(|| {
        ArchiveError::from(format!("this PowerPoint file has no {PRESENTATION} in it"))
    })??;
    let presentation = parse(PRESENTATION, &presentation_text)?;
    let relationships = archive
        .member_text(PRESENTATION_RELATIONSHIPS)
        .transpose()
        .ok()
        .flatten()
        .unwrap_or_default();
    let targets = relationship_targets(&relationships, "ppt");

    let mut blocks = Vec::new();
    let mut anchor: Option<(String, String)> = None;
    for (index, slide) in descendants(presentation.root_element(), "sldId").enumerate() {
        let Some(member) = relationship_id(slide)
            .and_then(|id| targets.get(id))
            .cloned()
        else {
            continue;
        };
        let Some(Ok(slide_text)) = archive.member_text(&member) else {
            continue;
        };
        let document = parse(&member, &slide_text)?;
        let shapes: Vec<roxmltree::Node> = descendants(document.root_element(), "txBody").collect();
        let title = shapes.iter().find(|shape| shape_is_title(**shape));
        let heading = title
            .map(|shape| element_text(*shape))
            .filter(|words| !words.is_empty())
            .unwrap_or_else(|| format!("Slide {}", index + 1));
        blocks.push(OfficeBlock::Heading {
            level: 2,
            text: heading,
            // The heading is the title shape's own words where it has one, and the slide's number where it has not — and a number is nothing in the member to point at.
            at: title.and_then(|shape| span(&member, *shape)),
        });
        for shape in &shapes {
            if title.is_some_and(|found| found.id() == shape.id()) {
                continue;
            }
            for paragraph in descendants(*shape, "p") {
                let words = element_text(paragraph);
                if words.is_empty() {
                    continue;
                }
                blocks.push(OfficeBlock::Paragraph {
                    text: words,
                    at: span(&member, paragraph),
                });
            }
        }
        // The first slide is the anchored member, for the reason a workbook anchors on its first sheet.
        anchor.get_or_insert((member, slide_text));
    }

    let (anchor, anchor_text) = anchor.unwrap_or((PRESENTATION.to_string(), presentation_text));
    Ok(OfficeDocument {
        // A deck's title is the first slide's, where that slide has one at all.
        title: blocks.first().and_then(|block| match block {
            OfficeBlock::Heading { text, at, .. } if at.is_some() => plain_document_title(text),
            _ => None,
        }),
        anchor,
        anchor_text,
        blocks,
    })
}

/// Whether a shape's text is the slide's title, read off the placeholder the shape declares rather than off where it sits.
fn shape_is_title(text_body: roxmltree::Node) -> bool {
    let Some(shape) = text_body.parent() else {
        return false;
    };
    descendants(shape, "ph")
        .filter_map(|placeholder| attribute(placeholder, "type"))
        .any(|kind| kind == "title" || kind == "ctrTitle")
}
