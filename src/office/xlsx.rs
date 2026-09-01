//! Excel workbooks. `xl/workbook.xml` names the sheets and points at them, and each sheet is its own member of rows and cells.
//!
//! **A cell's text usually is not in the sheet.** Excel's writer puts every string in `xl/sharedStrings.xml` and leaves the cell holding an index into it — measured on a real workbook, all 49 of its text cells, with none written inline. So reading a sheet means reading that table first. A cell may carry its text inline instead (`t="inlineStr"`), and a reader accepts either.
//!
//! A sheet is drawn as a record table: the first row is the header and the rows under it are the records, which is what every other structured format in this app already reads as.

use super::*;

const WORKBOOK: &str = "xl/workbook.xml";
const WORKBOOK_RELATIONSHIPS: &str = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS: &str = "xl/sharedStrings.xml";

pub(super) fn read(archive: &Archive<'_>) -> Result<OfficeDocument, ArchiveError> {
    let workbook_text = archive
        .member_text(WORKBOOK)
        .ok_or_else(|| ArchiveError::from(format!("this Excel file has no {WORKBOOK} in it")))??;
    let workbook = parse(WORKBOOK, &workbook_text)?;
    let relationships = archive
        .member_text(WORKBOOK_RELATIONSHIPS)
        .transpose()
        .ok()
        .flatten()
        .unwrap_or_default();
    let targets = relationship_targets(&relationships, "xl");
    let shared = archive
        .member_text(SHARED_STRINGS)
        .transpose()
        .ok()
        .flatten()
        .map(|text| shared_strings(&text))
        .unwrap_or_default();

    let mut blocks = Vec::new();
    let mut anchor: Option<(String, String)> = None;
    for sheet in descendants(workbook.root_element(), "sheet") {
        let name = attribute(sheet, "name").unwrap_or("Sheet").to_string();
        let Some(member) = relationship_id(sheet)
            .and_then(|id| targets.get(id))
            .cloned()
        else {
            continue;
        };
        let Some(Ok(sheet_text)) = archive.member_text(&member) else {
            continue;
        };
        // The sheet's name lives in the workbook, not in the sheet, so the heading it draws owns none of the member the rows are in.
        blocks.push(OfficeBlock::Heading {
            level: 2,
            text: name,
            at: None,
        });
        if let Some(table) = read_sheet(&member, &sheet_text, &shared)? {
            blocks.push(table);
        }
        // The first sheet is the anchored member: the buffer behind the page is one string, so a workbook has to pick one.
        anchor.get_or_insert((member, sheet_text));
    }

    let (anchor, anchor_text) = anchor.unwrap_or((WORKBOOK.to_string(), workbook_text));
    Ok(OfficeDocument {
        // A workbook has no title of its own — the sheets carry the names — so the page is headed by the file's name.
        title: None,
        anchor,
        anchor_text,
        blocks,
    })
}

/// One sheet as a record table. `None` where the sheet holds no rows at all, which is a blank sheet rather than a damaged one.
fn read_sheet(
    member: &str,
    text: &str,
    shared: &[String],
) -> Result<Option<OfficeBlock>, ArchiveError> {
    let document = parse(member, text)?;
    let Some(data) = descendants(document.root_element(), "sheetData").next() else {
        return Ok(None);
    };
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut spans: Vec<Vec<Option<Range<usize>>>> = Vec::new();
    let mut width = 0usize;
    for row in data
        .children()
        .filter(|child| child.is_element() && child.tag_name().name() == "row")
    {
        let mut cells: Vec<String> = Vec::new();
        let mut cell_spans: Vec<Option<Range<usize>>> = Vec::new();
        for cell in row
            .children()
            .filter(|child| child.is_element() && child.tag_name().name() == "c")
        {
            // A sheet writes only the cells that hold something, so a gap in the references is a gap in the row.
            let column = attribute(cell, "r")
                .and_then(column_index)
                .unwrap_or(cells.len());
            if cells.len() < column {
                cells.resize(column, String::new());
                cell_spans.resize(column, None);
            }
            let value = cell_text(cell, shared);
            // The cell's own element is the range an edit splices: the words it shows are usually in the shared table and have no range in this member at all, and a cell may say inline what it now says by index.
            let at = span(member, cell).map(|at| at.range);
            if cells.len() == column {
                cells.push(value);
                cell_spans.push(at);
            } else {
                cells[column] = value;
                cell_spans[column] = at;
            }
        }
        width = width.max(cells.len());
        rows.push(cells);
        spans.push(cell_spans);
    }
    if rows.is_empty() {
        return Ok(None);
    }
    for (row, cell_spans) in rows.iter_mut().zip(spans.iter_mut()) {
        row.resize(width, String::new());
        cell_spans.resize(width, None);
    }
    let header = rows.remove(0);
    Ok(Some(OfficeBlock::Table {
        header,
        rows,
        cell_spans: spans,
        at: span(member, data),
    }))
}

/// What one cell says. `t="s"` is an index into the shared table, `t="inlineStr"` carries the words itself, and everything else — a number, a date's serial number, a formula's last result — is the value as the sheet wrote it.
fn cell_text(cell: roxmltree::Node, shared: &[String]) -> String {
    match attribute(cell, "t") {
        Some("s") => child(cell, "v")
            .and_then(|value| element_text(value).parse::<usize>().ok())
            .and_then(|index| shared.get(index))
            .cloned()
            .unwrap_or_default(),
        Some("inlineStr") => child(cell, "is").map(element_text).unwrap_or_default(),
        // A boolean is written as 0 or 1 and read as the words a sheet shows.
        Some("b") => match child(cell, "v").map(|value| element_text(value)).as_deref() {
            Some("1") => "TRUE".to_string(),
            Some("0") => "FALSE".to_string(),
            _ => String::new(),
        },
        _ => child(cell, "v").map(element_text).unwrap_or_default(),
    }
}

/// The shared string table, in index order. A `<si>` may be one `<t>` or a run of them where the cell's formatting changed mid-word, and either way the string is all of its text.
fn shared_strings(text: &str) -> Vec<String> {
    let Ok(document) = roxmltree::Document::parse(text) else {
        return Vec::new();
    };
    document
        .root_element()
        .children()
        .filter(|child| child.is_element() && child.tag_name().name() == "si")
        .map(element_text)
        .collect()
}

/// Which column a cell reference names, counting from zero: `A1` is 0, `B7` is 1, `AA1` is 26.
fn column_index(reference: &str) -> Option<usize> {
    let letters: String = reference
        .chars()
        .take_while(|character| character.is_ascii_alphabetic())
        .collect();
    if letters.is_empty() {
        return None;
    }
    let mut index = 0usize;
    for letter in letters.bytes() {
        index = index * 26 + (letter.to_ascii_uppercase() - b'A' + 1) as usize;
    }
    Some(index - 1)
}
