//! The XML entry points, and the generic (non-TEI) reading renderer.
//!
//! TEI goes to [`crate::tei`], which knows its conventions. Everything else —
//! sitemaps, feeds, POMs, plists, config files — lands here, where there is no
//! schema to lean on, so the renderer reads the shape of the tree: leaves become
//! labeled fields, repeated flat records become tables, elements holding
//! elements become sections, mixed content becomes prose. Blocks emitted from a
//! single element carry its byte range, so editing anchors as TEI's does.

use crate::*;
use roxmltree::{Document, Node};

/// Child element names that can title their parent section, in priority order.
/// Shared with [`crate::data`], where they are JSON/YAML keys instead.
pub(crate) const LABEL_TAGS: [&str; 5] = ["title", "name", "head", "label", "heading"];

/// Of those, the ones that read as the section's own name and so head it bare.
/// The rest are qualified by their tag: `<author><name>` heads "Author: Ada".
const BARE_LABEL_TAGS: [&str; 4] = ["title", "head", "label", "heading"];

/// Attributes that name an element when no labeling child is present.
const LABEL_ATTRS: [&str; 4] = ["name", "id", "type", "class"];

/// Repeated records wider than this stay sections rather than becoming a table.
pub(crate) const MAX_TABLE_COLUMNS: usize = 8;

/// A record with a value longer than this reads as prose, not a table cell.
pub(crate) const MAX_TABLE_CELL_CHARS: usize = 200;

/// Nesting past this depth stops recursing and renders the remaining text, so a
/// pathologically deep file can't blow the stack.
pub(crate) const MAX_DEPTH: usize = 24;

/// Parse XML for reading. Doctypes are allowed through (plists and XHTML carry
/// one); roxmltree reads only the internal subset and never fetches anything.
pub(crate) fn parse_xml(xml: &str) -> Result<Document<'_>, roxmltree::Error> {
    let mut options = roxmltree::ParsingOptions::default();
    options.allow_dtd = true;
    Document::parse_with_options(xml, options)
}

/// Whether this document is TEI, and so belongs to the TEI renderer: a `<TEI>`
/// root (any version) or a `<teiHeader>` anywhere in it.
pub(crate) fn document_is_tei(doc: &Document) -> bool {
    let root = doc.root_element();
    let name = root.tag_name().name();
    if name.eq_ignore_ascii_case("TEI") || name.eq_ignore_ascii_case("TEI.2") {
        return true;
    }
    root.descendants()
        .any(|n| n.is_element() && n.tag_name().name().eq_ignore_ascii_case("teiHeader"))
}

/// Render any XML string to `(title, html, blocks)`, routing TEI to the TEI
/// renderer and everything else to the generic one. `fallback_title` (normally
/// the file name) heads the page when the document names no title of its own —
/// which is also what a `None` title reports.
pub(crate) fn render_xml_document(
    xml: &str,
    fallback_title: Option<&str>,
) -> (Option<String>, String, Vec<BlockSpan>) {
    let doc = match parse_xml(xml) {
        Ok(doc) => doc,
        Err(error) => return (None, xml_parse_error_html(&error), Vec::new()),
    };
    if document_is_tei(&doc) {
        let (title, ctx) = render_tei_inner(&doc);
        return (title, ctx.out, ctx.blocks);
    }
    let (title, ctx) = render_generic_document(&doc, fallback_title);
    (title, ctx.out, ctx.blocks)
}

/// The title and body HTML for any XML string, without the block map. The crawl
/// used this to title a file it had no intention of rendering; nothing does now
/// but the tests, which use it to check the title and the body in one call.
#[cfg(test)]
pub(crate) fn render_xml_body(xml: &str) -> (Option<String>, String) {
    let (title, html, _) = render_xml_document(xml, None);
    (title, html)
}

/// The block source map for any XML string, matching what [`render_xml_document`]
/// stamps inline. The document `<h1>` is not a block, so no fallback is needed.
pub(crate) fn xml_block_source_map(xml: &str) -> Vec<BlockSpan> {
    render_xml_document(xml, None).2
}

/// A file stem read as a document title: `sitemap` → `Sitemap`, `site-map` →
/// `Site map`. Used when the XML itself names no title.
pub(crate) fn xml_fallback_title(stem: &str) -> String {
    humanize_name(stem)
}

/// Reading-view message for a file that isn't well-formed XML. roxmltree's error
/// names the position, so show it — a bad file is usually a typo worth fixing.
pub(crate) fn xml_parse_error_html(error: &roxmltree::Error) -> String {
    format!(
        "<p><strong>XML parse error.</strong> {}</p>",
        encode_text(&error.to_string())
    )
}

// ---------------------------------------------------------------------------
// Generic renderer
// ---------------------------------------------------------------------------

pub(crate) struct XmlCtx {
    pub(crate) out: String,
    /// Source-anchored editing map: one entry per block that came from exactly
    /// one element, in document order.
    pub(crate) blocks: Vec<BlockSpan>,
    next_block_id: usize,
    seen: HashMap<String, usize>,
    /// The element whose text became the document `<h1>`, so it isn't repeated
    /// as a field or a section heading further down.
    title_node: Option<roxmltree::NodeId>,
}

impl XmlCtx {
    fn new() -> Self {
        Self {
            out: String::new(),
            blocks: Vec::new(),
            next_block_id: 0,
            seen: HashMap::new(),
            title_node: None,
        }
    }

    fn push(&mut self, s: &str) {
        self.out.push_str(s);
    }

    /// Record a `kind` block over `start..end` and return the `data-*` attribute
    /// string for its opening tag.
    fn block_attrs_range(&mut self, kind: &'static str, start: usize, end: usize) -> String {
        let id = self.next_block_id;
        self.next_block_id += 1;
        self.blocks.push(BlockSpan::new(id, kind, start, end));
        format!(
            " data-block-id=\"{id}\" data-src-start=\"{start}\" data-src-end=\"{end}\" data-block-kind=\"{kind}\"{}",
            if kind_is_editable(kind) {
                " data-editable=\"true\""
            } else {
                ""
            }
        )
    }

    /// Same, for a block that is exactly one element.
    fn block_attrs(&mut self, kind: &'static str, node: Node) -> String {
        let range = node.range();
        self.block_attrs_range(kind, range.start, range.end)
    }

    fn unique_slug(&mut self, text: &str) -> String {
        let base = tei_slugify(text);
        let count = self.seen.entry(base.clone()).or_insert(0);
        let slug = if *count == 0 {
            base.clone()
        } else {
            format!("{base}-{count}")
        };
        *count += 1;
        slug
    }
}

/// Render a non-TEI document: the title heading, then the root's children.
fn render_generic_document<'a>(
    doc: &'a Document<'a>,
    fallback_title: Option<&str>,
) -> (Option<String>, XmlCtx) {
    let mut ctx = XmlCtx::new();
    let root = doc.root_element();

    // The document's own title, if it has one: a title-ish child of the root, or
    // of the root's single wrapper child (an RSS `<channel>`, say).
    let title_node = pick_title_node(root);
    let title = title_node
        .map(element_text)
        .and_then(|text| plain_document_title(&text));
    if title.is_some() {
        ctx.title_node = title_node.map(|node| node.id());
    }

    // Head the document with its title, or with the caller's fallback so the
    // reading view always opens on a heading.
    let heading = title
        .clone()
        .or_else(|| fallback_title.and_then(plain_document_title));
    if let Some(heading) = heading {
        let id = ctx.unique_slug(&heading);
        // Anchor the heading to source only when it *is* an element's text.
        let attrs = match (title.is_some(), title_node) {
            (true, Some(node)) => ctx.block_attrs("heading", node),
            _ => String::new(),
        };
        ctx.push(&format!(
            "<h1{attrs} id=\"{}\">{}</h1>\n",
            encode_double_quoted_attribute(&id),
            encode_text(&heading)
        ));
    }

    // The root element's own attributes (a feed's `version`, a manifest's
    // `package`) carry real information; namespace declarations don't, and
    // roxmltree keeps those out of `attributes()` already.
    render_attribute_fields(root, &mut ctx);

    let children: Vec<Node> = root.children().filter(Node::is_element).collect();
    render_sequence(&children, &mut ctx, 0);

    (title, ctx)
}

/// The element whose text titles the document, searched in the root and — when
/// the root holds a single wrapper element — inside that wrapper too.
fn pick_title_node<'a>(root: Node<'a, 'a>) -> Option<Node<'a, 'a>> {
    let root_children: Vec<Node> = root.children().filter(Node::is_element).collect();
    let mut scopes = vec![root];
    if root_children.len() == 1 {
        scopes.push(root_children[0]);
    }
    for scope in scopes {
        for tag in LABEL_TAGS {
            let found = scope.children().find(|child| {
                child.is_element()
                    && child.tag_name().name().eq_ignore_ascii_case(tag)
                    && !element_text(*child).is_empty()
            });
            if found.is_some() {
                return found;
            }
        }
    }
    None
}

/// Render a run of sibling elements, grouping as it goes: repeated records
/// become one table, consecutive leaves become one field list, and anything
/// else renders on its own.
fn render_sequence<'a>(siblings: &[Node<'a, 'a>], ctx: &mut XmlCtx, depth: usize) {
    let mut i = 0;
    while i < siblings.len() {
        if let Some((end, columns)) = table_group(siblings, i) {
            render_table(&siblings[i..end], &columns, ctx);
            i = end;
            continue;
        }
        if is_leaf(siblings[i]) {
            let mut end = i;
            while end < siblings.len() && is_leaf(siblings[end]) {
                end += 1;
            }
            render_fields(&siblings[i..end], ctx);
            i = end;
            continue;
        }
        render_element(siblings[i], ctx, depth);
        i += 1;
    }
}

/// Render one element that holds other elements (or is deeper than
/// [`MAX_DEPTH`]): a heading, its attributes, then its children.
fn render_element<'a>(node: Node<'a, 'a>, ctx: &mut XmlCtx, depth: usize) {
    if depth >= MAX_DEPTH || has_own_text(node) {
        // Too deep to keep sectioning, or mixed text-and-markup content: render
        // what it says as a paragraph and stop.
        render_prose(node, ctx);
        return;
    }

    let (label, label_node) = container_label(node, ctx);
    if let Some(label) = label {
        let level = (2 + depth).min(6);
        let id = ctx.unique_slug(&label);
        let attrs = match label_node {
            Some(source) => ctx.block_attrs("heading", source),
            None => String::new(),
        };
        ctx.push(&format!(
            "<h{level}{attrs} id=\"{}\">{}</h{level}>\n",
            encode_double_quoted_attribute(&id),
            encode_text(&label)
        ));
    }

    render_attribute_fields(node, ctx);

    let label_id = label_node.map(|source| source.id());
    let children: Vec<Node> = node
        .children()
        .filter(|child| child.is_element() && Some(child.id()) != label_id)
        .collect();
    render_sequence(&children, ctx, depth + 1);
}

/// Render an element's text as a paragraph, flattening any inline markup.
fn render_prose<'a>(node: Node<'a, 'a>, ctx: &mut XmlCtx) {
    let text = element_text(node);
    if text.is_empty() {
        return;
    }
    let attrs = ctx.block_attrs("paragraph", node);
    ctx.push(&format!("<p{attrs}>{}</p>\n", encode_text(&text)));
}

/// The heading for a container: its labeling child's text, a naming attribute,
/// or the humanized tag name. Returns the source element the label came from so
/// the heading can be anchored to it.
fn container_label<'a>(node: Node<'a, 'a>, ctx: &XmlCtx) -> (Option<String>, Option<Node<'a, 'a>>) {
    // The wrapper that gave the document its title (an RSS `<channel>`) is
    // already spoken for by the `<h1>`; heading it again just repeats.
    if ctx.title_node.is_some()
        && node
            .children()
            .any(|child| Some(child.id()) == ctx.title_node)
    {
        return (None, None);
    }

    let tag_label = humanize_name(node.tag_name().name());
    for tag in LABEL_TAGS {
        let child = node.children().find(|child| {
            child.is_element()
                && child.tag_name().name().eq_ignore_ascii_case(tag)
                && !element_text(*child).is_empty()
        });
        if let Some(child) = child {
            let text = element_text(child);
            let label = if BARE_LABEL_TAGS.contains(&tag) {
                text
            } else {
                format!("{tag_label}: {text}")
            };
            return (Some(label), Some(child));
        }
    }
    for attr in LABEL_ATTRS {
        if let Some(value) = node
            .attributes()
            .find(|candidate| candidate.name().eq_ignore_ascii_case(attr))
            .map(|candidate| candidate.value().trim())
            .filter(|value| !value.is_empty())
        {
            return (Some(format!("{tag_label}: {value}")), None);
        }
    }
    (Some(tag_label), None)
}

/// Render leaf siblings as one label/value list. Empty elements and the element
/// already used as the document title are skipped.
fn render_fields<'a>(nodes: &[Node<'a, 'a>], ctx: &mut XmlCtx) {
    let mut rows = String::new();
    for node in nodes {
        if Some(node.id()) == ctx.title_node {
            continue;
        }
        let Some(value) = value_html(*node) else {
            continue;
        };
        let attrs = ctx.block_attrs("paragraph", *node);
        rows.push_str(&format!(
            "<dt>{}</dt><dd{attrs}>{value}</dd>\n",
            encode_text(&friendly_label(node.tag_name().name()))
        ));
    }
    if rows.is_empty() {
        return;
    }
    ctx.push(&format!("<dl class=\"data-fields\">\n{rows}</dl>\n"));
}

/// Render an element's attributes as a compact label/value list under its
/// heading. Nothing is emitted when it has none.
fn render_attribute_fields<'a>(node: Node<'a, 'a>, ctx: &mut XmlCtx) {
    let mut rows = String::new();
    for attribute in node.attributes() {
        let value = attribute.value().trim();
        if value.is_empty() {
            continue;
        }
        rows.push_str(&format!(
            "<dt>{}</dt><dd>{}</dd>\n",
            encode_text(&friendly_label(attribute.name())),
            linkify(value)
        ));
    }
    if rows.is_empty() {
        return;
    }
    ctx.push(&format!(
        "<dl class=\"data-fields data-attributes\">\n{rows}</dl>\n"
    ));
}

/// One cell of a record row.
struct Cell {
    /// Lower-cased column key: an attribute or child element name.
    key: String,
    /// The column heading this cell would give its column.
    label: String,
    /// The rendered value.
    html: String,
    /// Plain-text length, for deciding whether the run reads as a table.
    chars: usize,
}

/// The cells of one record: its attributes first, then its leaf children.
/// Repeated child names fold into a single comma-joined cell.
fn row_cells<'a>(node: Node<'a, 'a>) -> Vec<Cell> {
    let mut cells: Vec<Cell> = Vec::new();
    let mut push = |name: &str, text: &str| {
        let key = name.to_lowercase();
        let chars = text.chars().count();
        let html = linkify(text);
        match cells.iter_mut().find(|cell| cell.key == key) {
            Some(cell) => {
                cell.html.push_str(", ");
                cell.html.push_str(&html);
                cell.chars += chars + 2;
            }
            None => cells.push(Cell {
                key,
                label: friendly_label(name),
                html,
                chars,
            }),
        }
    };
    for attribute in node.attributes() {
        let value = attribute.value().trim();
        if !value.is_empty() {
            push(attribute.name(), value);
        }
    }
    for child in node.children().filter(|child| child.is_element()) {
        let text = element_text(child);
        if !text.is_empty() {
            push(child.tag_name().name(), &text);
        }
    }
    cells
}

/// Whether `siblings[start..]` opens a run of repeated records worth rendering
/// as a table, and if so where the run ends and what its columns are. A record
/// qualifies when it is a flat bag of short values — same tag, no prose, no
/// grandchildren.
fn table_group<'a>(
    siblings: &[Node<'a, 'a>],
    start: usize,
) -> Option<(usize, Vec<(String, String)>)> {
    let tag = siblings[start].tag_name().name();
    let mut end = start;
    while end < siblings.len() && siblings[end].tag_name().name() == tag {
        end += 1;
    }
    if end - start < 2 {
        return None;
    }

    let mut columns: Vec<(String, String)> = Vec::new();
    for node in &siblings[start..end] {
        if has_own_text(*node) {
            return None;
        }
        let has_grandchildren = node
            .children()
            .filter(|child| child.is_element())
            .any(|child| child.children().any(|inner| inner.is_element()));
        if has_grandchildren {
            return None;
        }
        let cells = row_cells(*node);
        if cells.is_empty() || cells.iter().any(|cell| cell.chars > MAX_TABLE_CELL_CHARS) {
            return None;
        }
        for cell in cells {
            if !columns.iter().any(|(key, _)| key == &cell.key) {
                columns.push((cell.key, cell.label));
            }
        }
        if columns.len() > MAX_TABLE_COLUMNS {
            return None;
        }
    }
    // A single-column table is just a list; leave it to the field renderer.
    if columns.len() < 2 {
        return None;
    }
    Some((end, columns))
}

/// Render a run of records as one table, one row per record.
fn render_table<'a>(rows: &[Node<'a, 'a>], columns: &[(String, String)], ctx: &mut XmlCtx) {
    let (Some(first), Some(last)) = (rows.first(), rows.last()) else {
        return;
    };
    let attrs = ctx.block_attrs_range("table", first.range().start, last.range().end);

    let mut html = format!("<table class=\"data-table\"{attrs}>\n<thead><tr>");
    for (_, label) in columns {
        html.push_str(&format!("<th>{}</th>", encode_text(label)));
    }
    html.push_str("</tr></thead>\n<tbody>\n");
    for row in rows {
        let cells = row_cells(*row);
        html.push_str("<tr>");
        for (key, _) in columns {
            let value = cells
                .iter()
                .find(|cell| &cell.key == key)
                .map(|cell| cell.html.as_str())
                .unwrap_or("");
            html.push_str(&format!("<td>{value}</td>"));
        }
        html.push_str("</tr>\n");
    }
    html.push_str("</tbody>\n</table>\n");
    ctx.push(&html);
}

// ---------------------------------------------------------------------------
// Values and labels
// ---------------------------------------------------------------------------

/// Whether an element holds no other elements, so it reads as a single value.
fn is_leaf(node: Node) -> bool {
    !node.children().any(|child| child.is_element())
}

/// Whether an element has text of its own (not counting whitespace between
/// child elements) — the mark of prose rather than structure.
fn has_own_text(node: Node) -> bool {
    node.children()
        .any(|child| child.is_text() && !child.text().unwrap_or("").trim().is_empty())
}

/// All of an element's text, whitespace collapsed to single spaces.
fn element_text(node: Node) -> String {
    node.descendants()
        .filter(|child| child.is_text())
        .filter_map(|child| child.text())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The value of a leaf element: its text, or — for an empty element that only
/// carries attributes, like an Atom `<link href="…">` — those attributes.
/// `None` when the element says nothing at all.
fn value_html(node: Node) -> Option<String> {
    let text = element_text(node);
    let attributes: Vec<(String, String)> = node
        .attributes()
        .map(|attribute| (attribute.name(), attribute.value().trim()))
        .filter(|(_, value)| !value.is_empty())
        .map(|(name, value)| (friendly_label(name), linkify(value)))
        .collect();
    let named = |attributes: &[(String, String)]| {
        attributes
            .iter()
            .map(|(label, value)| format!("{}: {value}", encode_text(label)))
            .collect::<Vec<_>>()
            .join(", ")
    };

    if !text.is_empty() {
        let mut html = linkify(&text);
        if !attributes.is_empty() {
            html.push_str(&format!(
                " <span class=\"data-value-attrs\">({})</span>",
                named(&attributes)
            ));
        }
        return Some(html);
    }
    match attributes.as_slice() {
        // The element's own label already names a lone attribute's value: an
        // Atom `<link href="…"/>` reads "Link: …", not "Link: Link: …".
        [] => None,
        [(_, only)] => Some(only.clone()),
        several => Some(named(several)),
    }
}

/// Escape a value, linking it when the whole of it is a URL. Only whole-value
/// URLs link, so prose can't be mangled by a stray `http://` inside it.
pub(crate) fn linkify(value: &str) -> String {
    let trimmed = value.trim();
    let is_url = !trimmed.contains(char::is_whitespace)
        && (trimmed.starts_with("http://")
            || trimmed.starts_with("https://")
            || trimmed.starts_with("mailto:"));
    if is_url {
        format!(
            "<a href=\"{}\">{}</a>",
            encode_double_quoted_attribute(trimmed),
            encode_text(trimmed)
        )
    } else {
        encode_text(value).into_owned()
    }
}

/// The reader-facing label for an element or attribute name. A handful of names
/// from the formats people actually open (sitemaps, feeds) read badly when
/// merely humanized, so they get spelled out. Shared with [`crate::data`], so a
/// sitemap and the JSON next to it label the same field the same way.
pub(crate) fn friendly_label(name: &str) -> String {
    match name.to_lowercase().as_str() {
        "loc" => "URL".to_string(),
        "url" | "uri" | "href" | "src" => "Link".to_string(),
        "lastmod" => "Last modified".to_string(),
        "changefreq" => "Change frequency".to_string(),
        "pubdate" => "Published".to_string(),
        "lastbuilddate" => "Last built".to_string(),
        "guid" | "id" => "ID".to_string(),
        "desc" => "Description".to_string(),
        _ => humanize_name(name),
    }
}

/// Turn an element or attribute name into a sentence-case label: `lastBuildDate`
/// → `Last build date`, `pub_date` → `Pub date`. Names that are already all
/// upper case (`URL`, `ISBN`) are left alone.
pub(crate) fn humanize_name(name: &str) -> String {
    let name = name.rsplit(':').next().unwrap_or(name);
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut previous_lower = false;
    for character in name.chars() {
        if character == '_' || character == '-' || character == '.' || character == ' ' {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            previous_lower = false;
            continue;
        }
        if character.is_uppercase() && previous_lower && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        previous_lower = character.is_lowercase() || character.is_numeric();
        current.push(character);
    }
    if !current.is_empty() {
        words.push(current);
    }
    if words.is_empty() {
        return name.to_string();
    }

    let all_upper = |word: &str| word.chars().all(|c| !c.is_lowercase());
    let mut label = String::new();
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            label.push(' ');
        }
        if all_upper(word) {
            label.push_str(word);
            continue;
        }
        let lowered = word.to_lowercase();
        if index == 0 {
            let mut chars = lowered.chars();
            match chars.next() {
                Some(first) => {
                    label.extend(first.to_uppercase());
                    label.push_str(chars.as_str());
                }
                None => {}
            }
        } else {
            label.push_str(&lowered);
        }
    }
    label
}
