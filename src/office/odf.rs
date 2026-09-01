//! OpenDocument text, spreadsheets and presentations. All three keep their words in `content.xml`, which is why one reader answers for the three formats.
//!
//! OpenDocument is flatter than the OOXML pair: a heading says its own level (`text:outline-level`) instead of naming a style two files away, and a cell holds its own text instead of an index into a shared table. What the body element is — `office:text`, `office:spreadsheet` or `office:presentation` — is what the file is, so nothing here has to be told which of the three it was handed.
//!
//! `mimetype` is the archive's first member and is stored uncompressed, at the byte offset a format sniffer looks for it. Nothing here moves it, because only the member being written is ever rewritten and the order is kept.

use super::*;

const CONTENT: &str = "content.xml";

pub(super) fn read(archive: &Archive<'_>) -> Result<OfficeDocument, ArchiveError> {
    let text = archive.member_text(CONTENT).ok_or_else(|| {
        ArchiveError::from(format!("this OpenDocument file has no {CONTENT} in it"))
    })??;
    let document = parse(CONTENT, &text)?;
    let root = document.root_element();
    let body = child(root, "body").ok_or_else(|| {
        ArchiveError::from(format!(
            "this OpenDocument file's {CONTENT} has no body in it"
        ))
    })?;
    let numbered = numbered_list_styles(root);

    let mut blocks = Vec::new();
    for content in body.children().filter(roxmltree::Node::is_element) {
        match content.tag_name().name() {
            "text" => read_prose(content, &numbered, &mut blocks),
            "spreadsheet" => read_sheets(content, &mut blocks),
            "presentation" => read_slides(content, &mut blocks),
            _ => {}
        }
    }

    let title = blocks.iter().find_map(|block| match block {
        OfficeBlock::Heading { text, .. } => plain_document_title(text),
        _ => None,
    });
    Ok(OfficeDocument {
        title,
        anchor: CONTENT.to_string(),
        anchor_text: text,
        blocks,
    })
}

/// A text document: headings, paragraphs, lists and tables, in the order they were written.
fn read_prose(body: roxmltree::Node, numbered: &HashSet<String>, blocks: &mut Vec<OfficeBlock>) {
    for node in body.children().filter(roxmltree::Node::is_element) {
        match node.tag_name().name() {
            "h" => {
                let words = element_text(node);
                if words.is_empty() {
                    continue;
                }
                // The page's own h1 is the title, so an outline level of 1 is the first heading under it.
                let level = attribute(node, "outline-level")
                    .and_then(|level| level.parse::<u8>().ok())
                    .unwrap_or(1);
                blocks.push(OfficeBlock::Heading {
                    level: (level + 1).min(6),
                    text: words,
                    at: span(CONTENT, node),
                });
            }
            "p" => {
                let words = element_text(node);
                if !words.is_empty() {
                    blocks.push(OfficeBlock::Paragraph {
                        text: words,
                        at: span(CONTENT, node),
                    });
                }
            }
            "list" => {
                let ordered =
                    attribute(node, "style-name").is_some_and(|style| numbered.contains(style));
                for item in node
                    .children()
                    .filter(|child| child.is_element() && child.tag_name().name() == "list-item")
                {
                    let words = element_text(item);
                    if !words.is_empty() {
                        blocks.push(OfficeBlock::ListItem {
                            ordered,
                            text: words,
                            at: span(CONTENT, item),
                        });
                    }
                }
            }
            "table" => {
                if let Some(table) = read_table(node) {
                    blocks.push(table);
                }
            }
            _ => {}
        }
    }
}

/// A spreadsheet: one heading per sheet, then that sheet's rows as a record table.
fn read_sheets(body: roxmltree::Node, blocks: &mut Vec<OfficeBlock>) {
    for sheet in body
        .children()
        .filter(|child| child.is_element() && child.tag_name().name() == "table")
    {
        blocks.push(OfficeBlock::Heading {
            level: 2,
            text: attribute(sheet, "name").unwrap_or("Sheet").to_string(),
            at: span(CONTENT, sheet),
        });
        if let Some(table) = read_table(sheet) {
            blocks.push(table);
        }
    }
}

/// A presentation: one heading per slide, then the words in its frames.
fn read_slides(body: roxmltree::Node, blocks: &mut Vec<OfficeBlock>) {
    for (index, slide) in body
        .children()
        .filter(|child| child.is_element() && child.tag_name().name() == "page")
        .enumerate()
    {
        blocks.push(OfficeBlock::Heading {
            level: 2,
            text: attribute(slide, "name")
                .map(str::to_string)
                .unwrap_or_else(|| format!("Slide {}", index + 1)),
            at: span(CONTENT, slide),
        });
        for paragraph in descendants(slide, "p") {
            let words = element_text(paragraph);
            if !words.is_empty() {
                blocks.push(OfficeBlock::Paragraph {
                    text: words,
                    at: span(CONTENT, paragraph),
                });
            }
        }
    }
}

/// A table as a header row and the rows under it. A cell may say it repeats, which is how OpenDocument writes a run of identical or empty cells.
fn read_table(node: roxmltree::Node) -> Option<OfficeBlock> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in descendants(node, "table-row") {
        let mut cells: Vec<String> = Vec::new();
        for cell in row
            .children()
            .filter(|child| child.is_element() && child.tag_name().name() == "table-cell")
        {
            let words = element_text(cell);
            let repeats = attribute(cell, "number-columns-repeated")
                .and_then(|count| count.parse::<usize>().ok())
                .unwrap_or(1);
            // A run of empty cells at the end of a row is padding a writer added, not columns anybody typed in.
            let repeats = if words.is_empty() {
                repeats.min(1)
            } else {
                repeats
            };
            for _ in 0..repeats {
                cells.push(words.clone());
            }
        }
        while cells.last().is_some_and(String::is_empty) {
            cells.pop();
        }
        rows.push(cells);
    }
    while rows.last().is_some_and(Vec::is_empty) {
        rows.pop();
    }
    if rows.is_empty() {
        return None;
    }
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    for row in &mut rows {
        row.resize(width, String::new());
    }
    let header = rows.remove(0);
    Some(OfficeBlock::Table {
        header,
        rows,
        // An OpenDocument cell holds its words in the member the table is in, so it needs no element of its own to point at.
        cell_spans: Vec::new(),
        at: span(CONTENT, node),
    })
}

/// Which list styles draw numbers rather than bullets. A style says so by the kind of level it declares, and a list names the style it was written with.
fn numbered_list_styles(root: roxmltree::Node) -> HashSet<String> {
    descendants(root, "list-style")
        .filter(|style| {
            descendants(*style, "list-level-style-number")
                .next()
                .is_some()
        })
        .filter_map(|style| attribute(style, "name"))
        .map(str::to_string)
        .collect()
}
