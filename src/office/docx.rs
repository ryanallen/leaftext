//! Word documents. `word/document.xml` is the text, and it is the member every block anchors to.
//!
//! A paragraph is flat — runs cannot nest — so `w:p` is a block and the `w:r`/`w:t` pieces under it are only where Word split the words when its own formatting changed. What makes a paragraph a heading is a style name in `w:pPr`, and what makes it a list item is a `w:numPr`; whether that list draws bullets or numbers is written in `word/numbering.xml`, two lookups away.
//!
//! Everything else in the package — styles, themes, comments, tracked changes, charts, media, macros — is read by nothing here, which is exactly why a save can leave it byte for byte alone.

use super::*;

/// The member a Word document's text is in, and the one its blocks anchor to.
const BODY: &str = "word/document.xml";
const NUMBERING: &str = "word/numbering.xml";

pub(super) fn read(archive: &Archive<'_>) -> Result<OfficeDocument, ArchiveError> {
    let text = archive
        .member_text(BODY)
        .ok_or_else(|| ArchiveError::from(format!("this Word file has no {BODY} in it")))??;
    let numbering = archive
        .member_text(NUMBERING)
        .transpose()
        .ok()
        .flatten()
        .unwrap_or_default();
    let ordered_lists = ordered_numbering_ids(&numbering);

    let document = parse(BODY, &text)?;
    let body = child(document.root_element(), "body")
        .ok_or_else(|| ArchiveError::from(format!("this Word file's {BODY} has no body in it")))?;

    let mut blocks = Vec::new();
    let mut title = None;
    for node in body.children().filter(roxmltree::Node::is_element) {
        match node.tag_name().name() {
            "p" => {
                let words = element_text(node);
                if words.is_empty() {
                    continue;
                }
                let at = span(BODY, node);
                match paragraph_style(node) {
                    // Word's Title style is what the document calls itself, so it heads the page rather than becoming another heading in it.
                    Style::Title if title.is_none() => {
                        title = Some(words.clone());
                        blocks.push(OfficeBlock::Heading {
                            level: 1,
                            text: words,
                            at,
                        });
                    }
                    // The page's own h1 is the title, so Word's Heading 1 is the first heading under it.
                    Style::Heading(level) => blocks.push(OfficeBlock::Heading {
                        level: (level + 1).min(6),
                        text: words,
                        at,
                    }),
                    Style::Title | Style::Body => match list_number_id(node) {
                        Some(number) => blocks.push(OfficeBlock::ListItem {
                            ordered: ordered_lists.contains(&number),
                            text: words,
                            at,
                        }),
                        None => blocks.push(OfficeBlock::Paragraph { text: words, at }),
                    },
                }
            }
            "tbl" => {
                if let Some(table) = read_table(node) {
                    blocks.push(table);
                }
            }
            _ => {}
        }
    }

    // A document with no Title style is titled by its first heading, which is what a reader would call it.
    if title.is_none() {
        title = blocks.iter().find_map(|block| match block {
            OfficeBlock::Heading { text, .. } => Some(text.clone()),
            _ => None,
        });
    }

    Ok(OfficeDocument {
        title: title.and_then(|text| plain_document_title(&text)),
        anchor: BODY.to_string(),
        anchor_text: text,
        blocks,
    })
}

/// What a paragraph's style makes it.
enum Style {
    Title,
    Heading(u8),
    Body,
}

fn paragraph_style(node: roxmltree::Node) -> Style {
    let Some(name) = child(node, "pPr")
        .and_then(|properties| child(properties, "pStyle"))
        .and_then(|style| attribute(style, "val"))
    else {
        return Style::Body;
    };
    if name.eq_ignore_ascii_case("Title") {
        return Style::Title;
    }
    // Word writes the style as `Heading1` and some writers as `heading 1`; both name the same level.
    let rest = name.strip_prefix("Heading").or_else(|| {
        name.to_ascii_lowercase()
            .starts_with("heading")
            .then(|| &name["heading".len()..])
    });
    match rest
        .map(str::trim)
        .and_then(|level| level.parse::<u8>().ok())
    {
        Some(level) if (1..=9).contains(&level) => Style::Heading(level),
        _ => Style::Body,
    }
}

/// The numbering definition a paragraph belongs to, where it is a list item at all.
fn list_number_id(node: roxmltree::Node) -> Option<u32> {
    child(node, "pPr")
        .and_then(|properties| child(properties, "numPr"))
        .and_then(|numbering| child(numbering, "numId"))
        .and_then(|id| attribute(id, "val"))
        .and_then(|id| id.parse().ok())
}

/// Which numbering definitions draw numbers rather than bullets, read off `word/numbering.xml`: a `w:num` names an abstract definition, and that definition's first level says which of the two it is.
fn ordered_numbering_ids(numbering: &str) -> HashSet<u32> {
    let mut ordered = HashSet::new();
    let Ok(document) = roxmltree::Document::parse(numbering) else {
        return ordered;
    };
    let root = document.root_element();
    let mut abstract_is_ordered: HashMap<&str, bool> = HashMap::new();
    for definition in descendants(root, "abstractNum") {
        let Some(id) = attribute(definition, "abstractNumId") else {
            continue;
        };
        let format = descendants(definition, "numFmt")
            .next()
            .and_then(|format| attribute(format, "val"))
            .unwrap_or("bullet");
        abstract_is_ordered.insert(id, !format.eq_ignore_ascii_case("bullet"));
    }
    for number in descendants(root, "num") {
        let (Some(id), Some(target)) = (
            attribute(number, "numId").and_then(|id| id.parse::<u32>().ok()),
            child(number, "abstractNumId").and_then(|link| attribute(link, "val")),
        ) else {
            continue;
        };
        if abstract_is_ordered.get(target).copied().unwrap_or(false) {
            ordered.insert(id);
        }
    }
    ordered
}

/// A Word table as a header row and the rows under it. An empty table is nothing to draw, so it is left out rather than drawn as an empty frame.
fn read_table(node: roxmltree::Node) -> Option<OfficeBlock> {
    let mut rows = node
        .children()
        .filter(|child| child.is_element() && child.tag_name().name() == "tr")
        .map(|row| {
            row.children()
                .filter(|child| child.is_element() && child.tag_name().name() == "tc")
                .map(element_text)
                .collect::<Vec<_>>()
        })
        .filter(|row: &Vec<String>| !row.is_empty())
        .collect::<Vec<_>>();
    if rows.is_empty() {
        return None;
    }
    let header = rows.remove(0);
    Some(OfficeBlock::Table {
        header,
        rows,
        // A Word cell holds its words where they are drawn, so the table's own range is all a splice needs.
        cell_spans: Vec::new(),
        at: span(BODY, node),
    })
}
