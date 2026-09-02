//! Word, Excel, PowerPoint and OpenDocument files: the shared block tree the four readers produce, and the pipeline that turns a file's bytes into the same `OpenedDocument` every other format arrives as.
//!
//! **One mechanism, six formats.** Each of these files is a zip of XML ([`zip`]), and this app already stamps a rendered block with the byte range it came out of. A zip member is one more place a proved range can point, so a Word paragraph anchors the way a TEI paragraph does — the difference is that the range is an offset into one member rather than into the file.
//!
//! **A block's anchor is a member and a range, never a bare offset.** A spreadsheet edit lands in `xl/worksheets/sheet2.xml` and an OpenDocument edit in `content.xml`, and an offset alone cannot say which file it is an offset into. The readers produce that pair; what the page is given is the *anchored* member's text, which is the one the code view colors.
//!
//! **One member is anchored, and only that one is written.** The buffer behind the page holds the anchored member's text and the archive it came out of, so a block in a second sheet or a second slide is stamped with no range at all and is read in the page rather than typed into — a range there would be spliced into the wrong file. A save puts the anchored member back and copies every other one byte for byte, which is what makes a style, a theme, a comment, a tracked change, a chart and a macro survive an edit.
//!
//! Nothing here reaches a disk, a process or a host. Every reader takes `&[u8]` and answers a tree, so the browser build carries them unchanged.

mod docx;
mod odf;
mod pptx;
/// The stands the suite builds and reads a package through, including the two archive shapes this tree's own writer never writes.
#[cfg(test)]
pub(crate) mod testing;
mod xlsx;
mod zip;

use crate::*;
use std::borrow::Cow;
use std::fmt::Write as _;
use std::ops::Range;
use zip::{Archive, ArchiveError};

/// Where a block's bytes are: which member of the archive, and the byte range inside that member's decompressed text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MemberSpan {
    pub(crate) member: String,
    pub(crate) range: Range<usize>,
}

/// One block of an office document, as the four readers produce it. `at` is `None` where a reader cannot vouch for the exact bytes — a sheet name lives in the workbook rather than in the sheet, so the heading it draws owns none of the member the rows are in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OfficeBlock {
    Heading {
        level: u8,
        text: String,
        at: Option<MemberSpan>,
    },
    Paragraph {
        text: String,
        at: Option<MemberSpan>,
    },
    ListItem {
        ordered: bool,
        text: String,
        at: Option<MemberSpan>,
    },
    /// A Word table, a sheet or a slide's rows: a header row and the rows under it.
    Table {
        header: Vec<String>,
        rows: Vec<Vec<String>>,
        /// Where each cell's own element is, header row first, for a sheet whose cells are elements of their own. Empty for a table whose cells hold their words where they are drawn, which is every table but a workbook's.
        cell_spans: Vec<Vec<Option<Range<usize>>>>,
        at: Option<MemberSpan>,
    },
}

impl OfficeBlock {
    /// The block's words, for the vault corpus and for a test asking what a document says.
    pub(crate) fn text(&self) -> String {
        match self {
            Self::Heading { text, .. } | Self::Paragraph { text, .. } => text.clone(),
            Self::ListItem { text, .. } => text.clone(),
            Self::Table { header, rows, .. } => {
                let mut lines = vec![header.join("\t")];
                lines.extend(rows.iter().map(|row| row.join("\t")));
                lines.join("\n")
            }
        }
    }

    /// Where this block's bytes are, where the reader proved it — the pair a splice takes, and what proves a range really does cut this block's own bytes.
    #[cfg(test)]
    pub(crate) fn at(&self) -> Option<&MemberSpan> {
        match self {
            Self::Heading { at, .. }
            | Self::Paragraph { at, .. }
            | Self::ListItem { at, .. }
            | Self::Table { at, .. } => at.as_ref(),
        }
    }
}

/// What a reader answers: the document's own title where it has one, the member whose text the page is given, and the blocks in reading order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OfficeDocument {
    pub(crate) title: Option<String>,
    /// The member the code view colors and the one an edit splices into. A document with more than one text member — a workbook of sheets, a deck of slides — anchors on the first, because the buffer behind the page is one string.
    pub(crate) anchor: String,
    pub(crate) anchor_text: String,
    pub(crate) blocks: Vec<OfficeBlock>,
}

/// Read a package's bytes as the document its format says it is.
///
/// Exhaustive on the format on purpose: a new one answers here rather than silently reading as a Word file. The nine text formats never reach this — [`crate::opened_document_from_bytes_with_host`] sends only a byte-shaped format down this path — and they say so rather than being a catch-all arm that would swallow the next format somebody adds.
fn read_document(
    archive: &Archive<'_>,
    format: DocumentFormat,
) -> Result<OfficeDocument, ArchiveError> {
    match format {
        DocumentFormat::Docx => docx::read(archive),
        DocumentFormat::Xlsx => xlsx::read(archive),
        DocumentFormat::Pptx => pptx::read(archive),
        DocumentFormat::Odt | DocumentFormat::Ods | DocumentFormat::Odp => odf::read(archive),
        DocumentFormat::Markdown
        | DocumentFormat::Xml
        | DocumentFormat::Json
        | DocumentFormat::Yaml
        | DocumentFormat::Eml
        | DocumentFormat::Html
        | DocumentFormat::Text
        | DocumentFormat::Ini
        | DocumentFormat::Code => Err(ArchiveError::from(format!(
            "a {} file is not a package this app unpacks",
            format.display_name()
        ))),
    }
}

/// A file's bytes as the document the app opens: unpack, read, render, and hand the result to the one routing table every other tree format goes through.
pub(crate) fn opened_document_from_office(
    bytes: &[u8],
    path: &Path,
    format: DocumentFormat,
    host: &dyn LeafHost,
) -> io::Result<OpenedDocument> {
    let archive = Archive::read(bytes).map_err(|refusal| unreadable(refusal, path))?;
    read_archive(&archive, path, format, host)
}

/// The document an edit buffer now holds, drawn out of the archive it came from with the buffer's own member answered in place of the packed one.
///
/// The buffer is already holding that member's text, so nothing here writes an archive. Packing that text into a whole new file to read it straight back copies every other member's bytes and rewrites every header for a file nothing keeps, and on a large package that copy is the whole of what a reader feels between typing a word and seeing it.
pub(crate) fn opened_document_from_package_buffer(
    package: &PackageBuffer,
    text: &str,
    path: &Path,
    host: &dyn LeafHost,
) -> io::Result<OpenedDocument> {
    let format = DocumentFormat::from_path(path);
    let archive = Archive::read(&package.bytes)
        .map_err(|refusal| unreadable(refusal, path))?
        .overriding(&package.member, text.as_bytes());
    read_archive(&archive, path, format, host)
}

/// Read an archive somebody has already opened as the document its format says it is, and hand it to the one routing table every tree format goes through. Both entries above share this so a render from a file and a render from a buffer cannot draw the same package two ways.
fn read_archive(
    archive: &Archive<'_>,
    path: &Path,
    format: DocumentFormat,
    host: &dyn LeafHost,
) -> io::Result<OpenedDocument> {
    let mut document =
        read_document(archive, format).map_err(|refusal| unreadable(refusal, path))?;
    // The render reads the member's name and never its text, so the source can move into the opened document.
    let source = std::mem::take(&mut document.anchor_text);
    Ok(render_document(
        &document,
        Cow::Owned(source),
        path,
        format,
        host,
    ))
}

/// Hand a parsed package to the one routing table every tree format goes through.
pub(crate) fn render_document(
    document: &OfficeDocument,
    source: Cow<'_, str>,
    path: &Path,
    format: DocumentFormat,
    host: &dyn LeafHost,
) -> OpenedDocument {
    let title = document.title.clone();
    crate::opened_document_from_tree(
        source,
        path,
        format,
        |_, fallback_title| {
            let (heading, html, blocks) = render(&document, fallback_title);
            (heading.or_else(|| title.clone()), html, blocks)
        },
        host,
    )
}

/// The anchored member's text and its name: the source the code view colors, the string a hash gate compares, and the member a save puts back. A package's members carry their own spelling, so the one this answers with is the only spelling there is to spend.
pub(crate) fn anchored_member_source(
    bytes: &[u8],
    path: &Path,
    format: DocumentFormat,
) -> io::Result<(SourceText, String, PackageDocument)> {
    let archive = Archive::read(bytes).map_err(|refusal| unreadable(refusal, path))?;
    let mut document =
        read_document(&archive, format).map_err(|refusal| unreadable(refusal, path))?;
    // The carried render reads the member's name and never its text, so the source can own the parsed string.
    let source = std::mem::take(&mut document.anchor_text);
    Ok((
        SourceText::utf8(source),
        document.anchor.clone(),
        PackageDocument(document),
    ))
}

/// The whole archive again with one member replaced by `text`, which is what a save writes.
///
/// Everything the app never opened travels across as the packed bytes it arrived as — a style, a theme, a comment, a tracked change, a chart, a macro — because the only member rewritten is the one the buffer holds. Member order is kept, so an OpenDocument file's `mimetype` stays first and stored where a format sniffer looks for it.
pub(crate) fn archive_with_member(bytes: &[u8], member: &str, text: &str) -> io::Result<Vec<u8>> {
    let archive = Archive::read(bytes).map_err(|refusal| unreadable(refusal, Path::new(member)))?;
    archive
        .with_member_replaced(member, text.as_bytes())
        .map_err(|refusal| unreadable(refusal, Path::new(member)))
}

/// What a package's own directory says about every member, hashed: the whole of the answer to whether the file moved, taken off the end of it rather than by unpacking it.
///
/// `tail` is the last bytes of the file and `tail_at` where in the file they begin. `None` where those bytes do not hold the whole directory, which is the caller's cue to read more of the tail — the reading is the caller's because the library reaches for no disk.
pub(crate) fn package_identity(tail: &[u8], tail_at: usize) -> Option<u64> {
    zip::package_identity(tail, tail_at)
}

/// A sheet cell's own element, rewritten to say `text` where it stands.
///
/// The cell is written as an **inline string**: its `r` and `s` attributes are kept, and `t="s"` with a `<v>` index becomes `t="inlineStr"` with an `<is><t>`. That is what a spreadsheet reaches by appending an `<si>` to `xl/sharedStrings.xml` and repointing the cell, without opening that table at all — so a string two cells share is never rewritten under the cell nobody typed in, and the edit stays one splice in one member. `None` where the bytes handed over are not a cell element, which is how a splice that is not a cell falls through to the ordinary one.
///
/// `text` is XML text and is written as it stands, the way every other splice in this app writes what it is handed: the page escapes what was typed before it sends it, so escaping again here would put `&amp;amp;` in somebody's spreadsheet.
pub(crate) fn sheet_cell_saying(element: &str, text: &str) -> Option<String> {
    let document = roxmltree::Document::parse(element).ok()?;
    let cell = document.root_element();
    if cell.tag_name().name() != "c" {
        return None;
    }
    let mut out = String::from("<c");
    for name in ["r", "s"] {
        if let Some(value) = attribute(cell, name) {
            let _ = write!(out, " {name}=\"{}\"", encode_double_quoted_attribute(value));
        }
    }
    // An empty cell says nothing rather than holding an empty string, which is what a sheet writes for one.
    if text.is_empty() {
        out.push_str("/>");
        return Some(out);
    }
    // `xml:space` is what keeps a leading or trailing space in the cell rather than letting a reader trim it away.
    let _ = write!(
        out,
        " t=\"inlineStr\"><is><t xml:space=\"preserve\">{text}</t></is></c>"
    );
    Some(out)
}

/// A document's words, for the vault corpus: what a Word file says, so a vault of them is searchable rather than silently dropped. `None` where the file is not a package this app reads, which is how the corpus leaves a damaged one out.
pub(crate) fn document_text(bytes: &[u8], format: DocumentFormat) -> Option<String> {
    let archive = Archive::read(bytes).ok()?;
    let document = read_document(&archive, format).ok()?;
    Some(
        document
            .blocks
            .iter()
            .map(OfficeBlock::text)
            .collect::<Vec<_>>()
            .join("\n\n"),
    )
}

fn unreadable(refusal: ArchiveError, path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("{refusal} ({})", path.display()),
    )
}

/// Draw the blocks as the document the reading view already knows how to show: headings, paragraphs, lists, and a record table for a sheet — every one of them a shape this app draws for some other format already, so nothing new is styled here.
///
/// A block is stamped with its byte range only where that range is in the **anchored** member, because that member is what the buffer behind the page holds: a range into a second sheet or a second slide would be spliced into the wrong file. A block that cannot be stamped wears no range at all, so it is read in the page and edited in the code view — the rule `data.rs` already decides by.
fn render(
    document: &OfficeDocument,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    let mut out = String::new();
    let mut blocks: Vec<BlockSpan> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let heading = document
        .title
        .clone()
        .or_else(|| fallback_title.and_then(plain_document_title));
    if let Some(heading) = &heading {
        let id = unique_slug(heading, &mut seen);
        let borrowed = if document.title.is_some() {
            ""
        } else {
            BORROWED_TITLE_ATTR
        };
        let _ = write!(
            out,
            "<h1{borrowed} id=\"{}\">{}</h1>\n",
            encode_double_quoted_attribute(&id),
            encode_text(heading)
        );
    }
    // The document's own title is drawn once, as the page's heading; drawing it again as the first block would head every Word file twice.
    let skip_first_heading = document.title.is_some();
    let mut list_open: Option<bool> = None;
    for (index, block) in document.blocks.iter().enumerate() {
        if skip_first_heading && index == 0 && matches!(block, OfficeBlock::Heading { .. }) {
            continue;
        }
        if !matches!(block, OfficeBlock::ListItem { .. }) {
            if let Some(ordered) = list_open.take() {
                out.push_str(if ordered { "</ol>\n" } else { "</ul>\n" });
            }
        }
        match block {
            OfficeBlock::Heading { level, text, at } => {
                let id = unique_slug(text, &mut seen);
                let attrs = stamp(document, at, "heading", &mut blocks);
                let _ = write!(
                    out,
                    "<h{level}{attrs} id=\"{}\">{}</h{level}>\n",
                    encode_double_quoted_attribute(&id),
                    encode_text(text)
                );
            }
            OfficeBlock::Paragraph { text, at } => {
                let attrs = stamp(document, at, "paragraph", &mut blocks);
                let _ = write!(out, "<p{attrs}>{}</p>\n", encode_text(text));
            }
            OfficeBlock::ListItem { ordered, text, at } => {
                if list_open != Some(*ordered) {
                    if let Some(was_ordered) = list_open {
                        out.push_str(if was_ordered { "</ol>\n" } else { "</ul>\n" });
                    }
                    out.push_str(if *ordered { "<ol>\n" } else { "<ul>\n" });
                    list_open = Some(*ordered);
                }
                let attrs = stamp(document, at, "list", &mut blocks);
                let _ = write!(out, "<li{attrs}>{}</li>\n", encode_text(text));
            }
            OfficeBlock::Table {
                header,
                rows,
                cell_spans,
                at,
            } => {
                let anchored_here = anchored(document, at);
                let attrs = stamp(document, at, "table", &mut blocks);
                out.push_str(&render_table(
                    header,
                    rows,
                    if anchored_here { cell_spans } else { &[] },
                    &attrs,
                ));
            }
        }
    }
    if let Some(ordered) = list_open {
        out.push_str(if ordered { "</ol>\n" } else { "</ul>\n" });
    }
    (heading, out, blocks)
}

/// Whether this block's bytes are in the member the buffer holds.
fn anchored(document: &OfficeDocument, at: &Option<MemberSpan>) -> bool {
    at.as_ref().is_some_and(|at| at.member == document.anchor)
}

/// The `data-*` attributes a block carries, and the entry it takes in the block list. Empty for a block whose bytes are somewhere the buffer is not.
fn stamp(
    document: &OfficeDocument,
    at: &Option<MemberSpan>,
    kind: &'static str,
    blocks: &mut Vec<BlockSpan>,
) -> String {
    if !anchored(document, at) {
        return String::new();
    }
    let range = at
        .as_ref()
        .expect("an anchored block carries a range")
        .range
        .clone();
    let id = blocks.len();
    blocks.push(BlockSpan::new(id, kind, range.start, range.end));
    format!(
        " data-block-id=\"{id}\" data-src-start=\"{}\" data-src-end=\"{}\" data-block-kind=\"{kind}\"",
        range.start, range.end
    )
}

/// One table. A sheet and a slide's rows take `data-table`, which is what every other structured format in this app already reads as; a Word table takes the plain drawing a Markdown table takes, because that is what it is.
///
/// A sheet's cells each carry their own element's range as well, because a workbook is the one document whose cell words are not in the member the table sits in: the text is in `xl/sharedStrings.xml` and the cell holds an index into it, so what an edit rewrites is the cell element rather than any run of words.
fn render_table(
    header: &[String],
    rows: &[Vec<String>],
    cell_spans: &[Vec<Option<Range<usize>>>],
    attrs: &str,
) -> String {
    let mut html = format!("<table class=\"data-table\"{attrs}>\n<thead><tr>");
    for (column, label) in header.iter().enumerate() {
        let _ = write!(
            html,
            "<th{}>{}</th>",
            cell_attrs(cell_spans, 0, column),
            encode_text(label)
        );
    }
    html.push_str("</tr></thead>\n<tbody>\n");
    for (index, row) in rows.iter().enumerate() {
        html.push_str("<tr>");
        for (column, cell) in row.iter().enumerate() {
            let label = header.get(column).map(String::as_str).unwrap_or_default();
            let _ = write!(
                html,
                "<td data-leaf-col=\"{}\"{}>{}</td>",
                encode_double_quoted_attribute(label),
                cell_attrs(cell_spans, index + 1, column),
                encode_text(cell)
            );
        }
        html.push_str("</tr>\n");
    }
    html.push_str("</tbody>\n</table>\n");
    html
}

/// Where one cell's own element is, or nothing where the reader could not prove one — an empty cell a sheet never wrote has no element to point at.
fn cell_attrs(cell_spans: &[Vec<Option<Range<usize>>>], row: usize, column: usize) -> String {
    match cell_spans.get(row).and_then(|cells| cells.get(column)) {
        Some(Some(range)) => format!(
            " data-cell-start=\"{}\" data-cell-end=\"{}\"",
            range.start, range.end
        ),
        _ => String::new(),
    }
}

/// A heading's anchor, uniqued the way every other renderer in the tree uniques one, so two sheets called Sheet1 do not both answer to the same address.
fn unique_slug(text: &str, seen: &mut HashMap<String, usize>) -> String {
    let base = tei_slugify(text);
    let count = seen.entry(base.clone()).or_insert(0);
    let slug = if *count == 0 {
        base.clone()
    } else {
        format!("{base}-{count}")
    };
    *count += 1;
    slug
}

/// All of an element's text, whitespace collapsed to single spaces. Word writes a paragraph as a run of `<w:t>` pieces split wherever its own formatting changed, so a paragraph's words are only ever the concatenation of its descendants.
fn element_text(node: roxmltree::Node) -> String {
    node.descendants()
        .filter(roxmltree::Node::is_text)
        .filter_map(|child| child.text())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The span a node covers inside one member — the pair a phase-3 edit splices into, proved here by the parser that read the member.
fn span(member: &str, node: roxmltree::Node) -> Option<MemberSpan> {
    let range = node.range();
    (range.start < range.end).then(|| MemberSpan {
        member: member.to_string(),
        range,
    })
}

/// Parse one member's XML, saying which member could not be read rather than which line of unnamed text could not.
fn parse<'a>(member: &str, text: &'a str) -> Result<roxmltree::Document<'a>, ArchiveError> {
    roxmltree::Document::parse(text).map_err(|error| {
        ArchiveError::from(format!("{member} inside this file is damaged: {error}"))
    })
}

/// A named child element, by local name — namespace prefixes differ between the two families and between writers, so nothing here matches on a prefix.
fn child<'a>(node: roxmltree::Node<'a, 'a>, name: &str) -> Option<roxmltree::Node<'a, 'a>> {
    node.children()
        .find(|child| child.is_element() && child.tag_name().name() == name)
}

/// Every descendant with this local name, in document order.
fn descendants<'a>(
    node: roxmltree::Node<'a, 'a>,
    name: &'a str,
) -> impl Iterator<Item = roxmltree::Node<'a, 'a>> + 'a {
    node.descendants()
        .filter(move |node| node.is_element() && node.tag_name().name() == name)
}

/// Which member each relationship id points at, spelled from the top of the archive. A part's relationships are written relative to the folder that part is in — `xl` for a workbook, `ppt` for a presentation — and a writer may spell one from the root of the package instead.
fn relationship_targets(text: &str, folder: &str) -> HashMap<String, String> {
    let mut targets = HashMap::new();
    let Ok(document) = roxmltree::Document::parse(text) else {
        return targets;
    };
    for relationship in descendants(document.root_element(), "Relationship") {
        let (Some(id), Some(target)) = (
            attribute(relationship, "Id"),
            attribute(relationship, "Target"),
        ) else {
            continue;
        };
        let member = match target.strip_prefix('/') {
            Some(absolute) => absolute.to_string(),
            None => format!("{folder}/{target}"),
        };
        targets.insert(id.to_string(), member);
    }
    targets
}

/// The namespace a part's pointer to another part is written in.
const RELATIONSHIPS_NAMESPACE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// The relationship id an element points at. Matched by namespace rather than by local name, because an element may carry a plain `id` of its own beside it — a slide carries both, and reading the wrong one points a deck at nothing.
fn relationship_id<'a>(node: roxmltree::Node<'a, 'a>) -> Option<&'a str> {
    node.attributes()
        .find(|attribute| {
            attribute.name() == "id" && attribute.namespace() == Some(RELATIONSHIPS_NAMESPACE)
        })
        .map(|attribute| attribute.value())
}

/// An attribute by local name, for the same reason [`child`] matches on one.
fn attribute<'a>(node: roxmltree::Node<'a, 'a>, name: &str) -> Option<&'a str> {
    node.attributes()
        .find(|attribute| attribute.name() == name)
        .map(|attribute| attribute.value())
}
