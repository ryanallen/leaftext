//! JSON, YAML, and XML (generic and TEI), including source-range proof.

use super::*;

#[test]
fn tei_lg_and_bare_l_render_as_verse_blockquotes() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text><body>
    <div type="translation">
      <lg>
        <l>When a tree rots,</l>
        <l>What use has it for blossoms and boughs?</l>
      </lg>
      <l>Bare line one,</l>
      <l>Bare line two.</l>
      <p>A prose paragraph.</p>
    </div>
  </body></text>
</TEI>"#;

    let (_title, html) = render_xml_body(xml);

    // The <lg> group becomes a blockquote with its lines joined by <br>.
    assert_contains(
            &html,
            "<blockquote class=\"tei-verse\">\n<p>When a tree rots,<br>\nWhat use has it for blossoms and boughs?</p>\n</blockquote>",
        );
    // Consecutive bare <l> lines (no <lg>) coalesce into one blockquote too.
    assert_contains(
            &html,
            "<blockquote class=\"tei-verse\">\n<p>Bare line one,<br>\nBare line two.</p>\n</blockquote>",
        );
    // A following non-<l> block ends the verse run and renders normally. (Match the closing text, since paragraphs carry inline source-range attributes.)
    assert_contains(&html, ">A prose paragraph.</p>");
    // No leftover plain verse paragraph markup.
    assert!(!html.contains("<p class=\"tei-verse\">"));
}

#[test]
fn tei_title_prefers_english_and_stacks_sanskrit_and_long_titles() {
    // A title matrix listing Tibetan first, to prove selection is by type + xml:lang, not document order. Uses the odd lang casing seen in the wild.
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt>
    <title type="mainTitle" xml:lang="Bo-Ltn">rab tu 'byung ba'i gzhi</title>
    <title type="mainTitle" xml:lang="bo">bo-script-title</title>
    <title type="mainTitle" xml:lang="en">The Chapter on Going Forth</title>
    <title type="mainTitle" xml:lang="Sa-Ltn">Pravrajyāvastu</title>
    <title type="longTitle" xml:lang="en">"Going Forth" from The Chapters on Monastic Discipline</title>
    <title type="longTitle" xml:lang="Sa-Ltn">Vinayavastu Pravrajyāvastu</title>
    <title type="longTitle" xml:lang="Bo-Ltn">'dul ba gzhi las</title>
  </titleStmt></fileDesc></teiHeader>
  <text><body><div type="translation"><p>Body.</p></div></body></text>
</TEI>"#;

    let (title, html) = render_xml_body(xml);

    // The returned title (window/tab/library) is the English main title.
    assert_eq!(title.as_deref(), Some("The Chapter on Going Forth"));
    assert_contains(&html, ">The Chapter on Going Forth</h1>");

    // Under the h1: Sanskrit main title, English long title, Sanskrit long title, in that order, with Sanskrit in italics.
    assert_contains(&html, "<div class=\"tei-doc-subtitles\">");
    // Three subtitle lines, each anchored to its own `<title>` element, so the class and the words are asserted apart from the range that sits between them.
    assert_eq!(html.matches("<p class=\"tei-doc-subtitle\"").count(), 3);
    assert_contains(&html, "<em>Pravrajyāvastu</em></p>");
    assert_contains(&html, "<em>Vinayavastu Pravrajyāvastu</em></p>");
    let main_sa = html
        .find("<em>Pravrajyāvastu</em>")
        .expect("Sanskrit main title rendered");
    let long_en = html
        .find("Going Forth\" from The Chapters")
        .expect("English long title rendered");
    let long_sa = html
        .find("<em>Vinayavastu Pravrajyāvastu</em>")
        .expect("Sanskrit long title rendered");
    assert!(
        main_sa < long_en && long_en < long_sa,
        "subtitles keep the order: sa main, en long, sa long"
    );

    // Tibetan titles never appear, in any script.
    assert!(!html.contains("rab tu"));
    assert!(!html.contains("bo-script-title"));
    assert!(!html.contains("'dul ba"));
}

#[test]
fn tei_front_matter_renders_collapsed_before_the_body() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>The Sutra</title></titleStmt></fileDesc></teiHeader>
  <text>
    <front>
      <div type="summary">
        <head>Summary</head>
        <p>This is the summary.</p>
      </div>
      <div type="acknowledgment">
        <head>Acknowledgments</head>
        <p>Thanks to the team.</p>
      </div>
    </front>
    <body>
      <div type="translation">
        <p>The body text.</p>
      </div>
    </body>
  </text>
</TEI>"#;

    let (_title, html) = render_xml_body(xml);

    // The front becomes a collapsed <details> (no `open` attribute) labeled with its section headings, and it holds the summary/acknowledgment text.
    assert_contains(
            &html,
            "<details class=\"tei-front\">\n<summary class=\"tei-front-summary\">Summary, Acknowledgments</summary>",
        );
    assert!(
        !html.contains("<details class=\"tei-front\" open"),
        "front must start collapsed"
    );
    assert_contains(&html, ">This is the summary.</p>");
    // The front closes before the body content, so the body is not inside it.
    let front_end = html.find("</details>").expect("front details closes");
    let body_at = html.find(">The body text.</p>").expect("body renders");
    assert!(front_end < body_at, "front must render before the body");
}

#[test]
fn tei_headings_shrink_with_nesting_never_invert() {
    // A `chapter` nested in a `section`: a type→level table would render the nested chapter larger, so heading level must follow nesting depth.
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text><body>
    <div type="translation">
      <div type="section">
        <head>Outer Section</head>
        <div type="chapter">
          <head>Inner Chapter</head>
          <div type="section">
            <head>Deeper Section</head>
          </div>
        </div>
      </div>
    </div>
  </body></text>
</TEI>"#;

    let (_title, html) = render_xml_body(xml);

    // Transparent `translation` adds no depth: h2, h3, h4, strictly shrinking. Match on id + text, since headings carry inline source-range attributes.
    assert_contains(&html, r#"id="outer-section">Outer Section</h2>"#);
    assert_contains(&html, r#"id="inner-chapter">Inner Chapter</h3>"#);
    assert_contains(&html, r#"id="deeper-section">Deeper Section</h4>"#);
}

// ---------------------------------------------------------------------------
// Generic (non-TEI) XML
// ---------------------------------------------------------------------------

/// One page shaped the way Emptyguru's published translations are shaped, since that site draws its 375 scholarly pages through this renderer. Everything a reader of one of those pages sees at once: the English title chosen out of four languages, the collapsed front matter, sections holding chapters holding sections, verse, and an end note that becomes a numbered footnote with a way back to where it was cited.
#[test]
fn a_published_translation_renders_its_titles_verse_and_end_notes() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt>
    <title type="mainTitle" xml:lang="en">The Chapter on Going Forth</title>
    <title type="mainTitle" xml:lang="Sa-Ltn">Pravrajyāvastu</title>
    <title type="longTitle" xml:lang="en">“The Chapter on Going Forth” from The Chapters on Monastic Discipline</title>
  </titleStmt></fileDesc></teiHeader>
  <text>
    <front><div type="summary"><head>Summary</head><p>What this text is about.</p></div></front>
    <body>
      <div type="translation">
        <div type="section">
          <head>The Setting</head>
          <p>The Blessed One was staying at Rājagṛha.<note place="end" xml:id="UT-1">Toh 1, folio 3.a.</note></p>
          <div type="chapter">
            <head>Going Forth</head>
            <lg>
              <l>When a tree rots,</l>
              <l>What use has it for blossoms and boughs?</l>
            </lg>
          </div>
        </div>
      </div>
      <div type="notes"><head>Notes</head></div>
    </body>
  </text>
</TEI>"#;

    let (title, html) = render_xml_body(xml);

    assert_eq!(title.as_deref(), Some("The Chapter on Going Forth"));
    // The other languages stack under the title rather than competing with it.
    assert_contains(&html, "Pravrajyāvastu");
    // The front matter is there and closed, so the reader lands on the translation.
    assert_contains(&html, "<details class=\"tei-front\"");
    assert!(
        !html.contains("<details class=\"tei-front\" open"),
        "a published page opens on its front matter"
    );
    // A chapter inside a section is drawn smaller than the section holding it — the fix Emptyguru's own copy never received.
    assert_contains(&html, r#"id="the-setting">The Setting</h2>"#);
    assert_contains(&html, r#"id="going-forth">Going Forth</h3>"#);
    // Verse is a blockquote with its lines joined, not a paragraph of run-together text.
    assert_contains(
        &html,
        "<blockquote class=\"tei-verse\">\n<p>When a tree rots,<br>\nWhat use has it for blossoms and boughs?</p>\n</blockquote>",
    );
    // An end note is cited where it was written and defined at the foot, with a way back.
    assert_contains(&html, "<sup class=\"footnote-reference\"");
    assert_contains(&html, "<div class=\"footnote-definition\" id=\"fn1\">");
    assert_contains(&html, "Toh 1, folio 3.a.");
    assert_contains(&html, "class=\"footnote-backref\"");
}

#[test]
fn sitemap_records_render_as_a_table_of_links() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://leaftext.com/</loc>
    <lastmod>2026-07-24</lastmod>
  </url>
  <url>
    <loc>https://leaftext.com/docs/</loc>
    <lastmod>2026-07-11</lastmod>
  </url>
</urlset>"#;

    let (title, html) = render_xml_body(xml);

    // A sitemap names no title of its own; the file name heads it (see `opened_document_from_xml`), so the renderer reports none.
    assert!(title.is_none(), "{title:?}");
    // Repeated flat records become one table, with spelled-out column headings.
    assert_contains(&html, "<table class=\"data-table\"");
    assert_contains(&html, "<th>URL</th><th>Last modified</th>");
    assert_contains(&html, ">https://leaftext.com/</a></td><td data-cell-start=");
    assert_contains(&html, ">2026-07-24</td>");
    // And nothing of the TEI renderer's leaks through.
    assert!(!html.contains("No TEI body"), "{html}");
}

/// The XML a table's cell stamps are proved against: an attribute column, a folded column, a column one record is short of, and two plain ones.
const CELL_STAMP_XML: &str = r#"<urlset>
  <url id="a"><loc>https://leaftext.com/</loc><lastmod>2026-07-24</lastmod><tag>one</tag><tag>two</tag></url>
  <url id="b"><loc>https://leaftext.com/docs/</loc><tag>three</tag></url>
</urlset>"#;

/// Every `<td>` of the first table in `html`, as its opening tag.
fn table_cell_tags(html: &str) -> Vec<&str> {
    table_tags(html, "<td")
}

/// The number an opening tag carries under `name`, which is written `data-value-start="`, quote and all.
fn stamp_offset(tag: &str, name: &str) -> usize {
    let from = tag.find(name).expect("the name") + name.len();
    tag[from..from + tag[from..].find('"').expect("a closed value")]
        .parse()
        .expect("a number")
}

/// Every opening tag in the first table of `html` starting with `mark`.
fn table_tags<'a>(html: &'a str, mark: &str) -> Vec<&'a str> {
    let table = &html[html.find("<table").expect("a table")..];
    table
        .match_indices(mark)
        .map(|(at, _)| &table[at..at + table[at..].find('>').expect("a closed tag") + 1])
        .collect()
}

#[test]
fn a_table_cell_carries_the_bytes_of_the_element_it_was_drawn_from() {
    // Typing in a cell rests on something naming that value's own bytes. A cell drawn from an element names the element whole, tags and all; one drawn from an attribute names the bytes inside its quotes, which is a different proof and so a different pair of names. A cell invented because the record was short of that column is nobody's bytes and names neither, and a cell two values folded into names neither either — each of them is a span of its own inside it, and the separator between them belongs to neither.
    let (_title, html) = render_xml_body(CELL_STAMP_XML);

    let tags = table_cell_tags(&html);
    // Four columns — the attribute, the address, the date, the folded tags — over two records.
    assert_eq!(tags.len(), 8, "{html}");
    let stamped: Vec<bool> = tags
        .iter()
        .map(|tag| tag.contains("data-cell-start"))
        .collect();
    // Row one: the attribute, the address, the date, the two tags folded together. Row two: the attribute, the address, the column it is short of, its single tag.
    assert_eq!(
        stamped,
        vec![false, true, true, false, false, true, false, true],
        "{tags:?}"
    );
    // The two attribute-drawn cells carry the bytes inside their quotes instead, and never the element names beside them.
    let inside_quotes: Vec<bool> = tags
        .iter()
        .map(|tag| tag.contains("data-value-start"))
        .collect();
    assert_eq!(
        inside_quotes,
        vec![true, false, false, false, true, false, false, false],
        "{tags:?}"
    );
    // And what it names is the value inside the quotes, never the tag around it.
    assert_eq!(
        &CELL_STAMP_XML[stamp_offset(tags[0], "data-value-start=\"")
            ..stamp_offset(tags[0], "data-value-end=\"")],
        "a"
    );
    // The folded cell's two elements, each on a span of its own, and the separator on neither.
    let spans = table_tags(&html, "<span");
    assert_eq!(spans.len(), 2, "{html}");
    assert!(
        spans.iter().all(|tag| tag.contains("data-cell-start")),
        "{spans:?}"
    );
    assert_contains(&html, "<td><span data-cell-start=");
    assert_contains(&html, "</span>, <span data-cell-start=");
    // And never the names a block is found by, or the gutter would offer a cell a drag handle.
    assert!(
        !tags.iter().any(|tag| tag.contains("data-src-start")),
        "{tags:?}"
    );
    assert!(
        !spans.iter().any(|tag| tag.contains("data-src-start")),
        "{spans:?}"
    );
}

#[test]
fn a_table_cells_range_slices_out_its_whole_element() {
    // The page proves a cell by finding the tags inside the slice and comparing what is between them with the drawn words, so the stamp has to be the element whole. An inner range would hand it a slice with no tags in it.
    let (_title, html) = render_xml_body(CELL_STAMP_XML);

    let offset = |tag: &str, name: &str| -> Option<usize> {
        let from = tag.find(name)? + name.len();
        tag[from..from + tag[from..].find('"')?].parse().ok()
    };
    let mut sliced: Vec<&str> = Vec::new();
    // Every stamp in the table, wherever it sits: on the cell where one element drew it, and on a span each where several folded into one cell.
    let mut tags = table_cell_tags(&html);
    tags.extend(table_tags(&html, "<span"));
    for tag in tags {
        let (Some(start), Some(end)) = (
            offset(tag, "data-cell-start=\""),
            offset(tag, "data-cell-end=\""),
        ) else {
            continue;
        };
        sliced.push(&CELL_STAMP_XML[start..end]);
    }
    assert_eq!(
        sliced,
        vec![
            "<loc>https://leaftext.com/</loc>",
            "<lastmod>2026-07-24</lastmod>",
            "<loc>https://leaftext.com/docs/</loc>",
            "<tag>three</tag>",
            "<tag>one</tag>",
            "<tag>two</tag>",
        ],
    );
}

/// The XML an element's own attribute list is proved against: a value the file spells the way the page draws it, one padded with spaces the renderer trims off, and one written with an entity the parser hands back as a single character.
const ATTRIBUTE_STAMP_XML: &str = r#"<feed id="chapter-4" updated=" 2026-08-13 " note="Cats &amp; dogs">
  <entry>Words enough to render.</entry>
</feed>"#;

/// Every `<dd>` of the attribute list in `html`, as its opening tag.
fn attribute_value_tags(html: &str) -> Vec<&str> {
    let list = &html[html.find("data-attributes").expect("an attribute list")..];
    let list = &list[..list.find("</dl>").expect("a closed list")];
    list.match_indices("<dd")
        .map(|(at, _)| &list[at..at + list[at..].find('>').expect("a closed tag") + 1])
        .collect()
}

#[test]
fn an_attribute_carries_its_own_bytes_only_where_the_page_draws_them_unchanged() {
    // Typing on a value inside a tag rests on the drawn words being the file's own bytes. A value the renderer trimmed, and one the file spells with an entity, are neither — so they name no range and answer a press the way they do today.
    let (_title, html) = render_xml_body(ATTRIBUTE_STAMP_XML);

    let tags = attribute_value_tags(&html);
    let stamped: Vec<bool> = tags
        .iter()
        .map(|tag| tag.contains("data-value-start"))
        .collect();
    assert_eq!(stamped, vec![true, false, false], "{tags:?}");
    // And never the names a block is found by, or the gutter would offer a value a drag handle.
    assert!(
        !tags.iter().any(|tag| tag.contains("data-src-start")),
        "{tags:?}"
    );
}

#[test]
fn an_attributes_range_slices_out_the_value_between_its_quotes() {
    // The page holds the drawn words against exactly these bytes, so the stamp has to stop inside both quotes: a byte either side and every value on the page would refuse itself.
    let (_title, html) = render_xml_body(ATTRIBUTE_STAMP_XML);

    let tag = attribute_value_tags(&html)[0];
    let start = stamp_offset(tag, "data-value-start=\"");
    let end = stamp_offset(tag, "data-value-end=\"");
    assert_eq!(&ATTRIBUTE_STAMP_XML[start..end], "chapter-4");
    // The bytes on either side are the quotes the value is written inside, which the splice must never reach.
    assert_eq!(&ATTRIBUTE_STAMP_XML[start - 1..start], "\"");
    assert_eq!(&ATTRIBUTE_STAMP_XML[end..end + 1], "\"");
}

/// The XML the composed run is proved against: an element with words of its own and two values packed into the parenthetical after them.
const COMPOSED_VALUE_XML: &str = r#"<feed>
  <entry type="post" lang="en">Words here.</entry>
</feed>"#;

#[test]
fn a_value_composed_with_others_carries_its_own_bytes_and_not_its_label() {
    // Several values drawn as one run take labels and commas the file has not got, so a range over the run would splice the renderer's own words into somebody's file. Each value is drawn in an element of its own with all of that outside it.
    let (_title, html) = render_xml_body(COMPOSED_VALUE_XML);

    // The label and the separator sit outside the element the range is on.
    assert_contains(&html, "(Type: <span data-value-start=");
    assert_contains(&html, "</span>, Lang: <span data-value-start=");

    let tags: Vec<&str> = html
        .match_indices("<span data-value-start=")
        .map(|(at, _)| &html[at..at + html[at..].find('>').expect("a closed tag") + 1])
        .collect();
    assert_eq!(tags.len(), 2, "{html}");
    let sliced: Vec<&str> = tags
        .iter()
        .map(|tag| {
            &COMPOSED_VALUE_XML
                [stamp_offset(tag, "data-value-start=\"")..stamp_offset(tag, "data-value-end=\"")]
        })
        .collect();
    assert_eq!(sliced, vec!["post", "en"]);
}

#[test]
fn feed_renders_its_title_fields_and_entries() {
    let xml = r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Leaf Notes</title>
  <link>https://leaftext.com/feed</link>
  <lastBuildDate>Mon, 20 Jul 2026 09:00:00 GMT</lastBuildDate>
  <item>
    <title>First post</title>
    <link>https://leaftext.com/1</link>
    <description>A paragraph of prose that is long enough to be read as prose rather than as a table cell, which is the whole point of the length limit the record table applies.</description>
  </item>
</channel></rss>"#;

    let (title, html) = render_xml_body(xml);

    // The channel title titles the document, and isn't repeated as a field or as a heading for the wrapper it came from.
    assert_eq!(title.as_deref(), Some("Leaf Notes"));
    assert_contains(&html, ">Leaf Notes</h1>");
    assert_eq!(html.matches("Leaf Notes").count(), 1, "{html}");
    assert!(!html.contains(">Channel</h2>"), "{html}");

    // Leaf children become one label/value list, camelCase names read as words, and a lone URL value links.
    assert_contains(&html, "<dl class=\"data-fields\">");
    assert_contains(&html, "<dt>Last built</dt>");
    assert_contains(
        &html,
        "<a href=\"https://leaftext.com/feed\">https://leaftext.com/feed</a>",
    );

    // The item is a section headed by its own title — one record is not a table.
    assert_contains(&html, ">First post</h3>");
    assert!(!html.contains("<table"), "{html}");
}

#[test]
fn atom_link_attributes_stand_in_for_missing_text() {
    let xml = r#"<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Feed</title>
  <link href="http://example.org/"/>
  <category term="news" scheme="https://example.org/categories"/>
  <author><name>Ada</name><email>ada@example.org</email></author>
</feed>"#;

    let (_title, html) = render_xml_body(xml);

    // An empty element with one attribute shows that attribute as its value, unlabeled — the element's own label already names it. (Match around the inline source-range attributes.)
    assert_contains(&html, "<dt>Link</dt><dd data-block-id=");
    assert_contains(
        &html,
        "<a href=\"http://example.org/\">http://example.org/</a></span></dd>",
    );
    assert!(!html.contains("Link: <a"), "{html}");
    let link_row = &html[html.find("<dt>Link</dt>").expect("the link row")..];
    let link_row = &link_row[..link_row.find("</dd>").expect("the end of the link row")];
    let span = &link_row[link_row
        .find("<span data-value-start=")
        .expect("the ranged link")..];
    let span = &span[..span.find('>').expect("the end of the ranged link") + 1];
    assert_eq!(
        &xml[stamp_offset(span, "data-value-start=\"")..stamp_offset(span, "data-value-end=\"")],
        "http://example.org/"
    );
    assert_contains(&html, "Term: <span data-value-start=");
    assert_contains(&html, "</span>, Scheme: <span data-value-start=");
    // A section named by a `<name>` child is qualified by its tag, so a person's name doesn't read as a section title on its own.
    assert_contains(&html, ">Author: Ada</h2>");
}

#[test]
fn a_lone_attribute_value_is_drawn_in_its_own_ranged_element() {
    let xml = r#"<feed><category term="news"/></feed>"#;
    let (_title, html) = render_xml_body(xml);

    assert_contains(&html, "<dt>Category</dt><dd data-block-id=");
    assert_contains(&html, "<span data-value-start=");
    assert_contains(&html, ">news</span></dd>");
}

#[test]
fn generic_xml_blocks_anchor_to_their_source_elements() {
    let xml = "<config><name>Widget</name><timeout>30</timeout>\
               <note>Some prose with <b>markup</b> in it.</note></config>";

    let (_title, html, blocks, _dialect) = render_xml_document(xml, None);

    // Every stamped block slices back to the element it was rendered from.
    assert!(!blocks.is_empty());
    for block in &blocks {
        let slice = &xml[block.start..block.end];
        assert!(slice.starts_with('<') && slice.ends_with('>'), "{slice}");
    }
    // The map matches what the HTML carries, and matches the editing model's.
    assert_eq!(blocks, xml_block_source_map(xml));
    assert_contains(&html, "data-src-start=");
    // Mixed text-and-markup content renders as a paragraph of its text.
    assert_contains(&html, ">Some prose with markup in it.</p>");
}

#[test]
fn xml_with_a_doctype_still_renders() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key>
  <string>Leaftext</string>
</dict></plist>"#;

    let (_title, html) = render_xml_body(xml);

    assert_contains(&html, "<dt>Key</dt>");
    assert_contains(&html, ">CFBundleName</dd>");
    assert!(!html.contains("parse error"), "{html}");
}

#[test]
fn malformed_xml_reports_where_it_broke() {
    let (title, html) = render_xml_body("<a><b></a>");

    assert!(title.is_none());
    assert_contains(&html, "<strong>XML parse error.</strong>");
    assert_contains(&html, "1:7");
}

#[test]
fn untitled_xml_is_headed_by_its_file_name() {
    let xml = "<urlset><url><loc>https://leaftext.com/</loc><lastmod>2026-07-24</lastmod></url>\
               <url><loc>https://leaftext.com/docs/</loc><lastmod>2026-07-11</lastmod></url></urlset>";

    let document = opened_document_from_xml(xml, "sitemap.xml");

    assert_eq!(document.format, DocumentFormat::Xml);
    assert_eq!(document.title, "Sitemap");
    assert_contains(
        &document.html,
        "<h1 data-borrowed-title id=\"sitemap\">Sitemap</h1>",
    );
    // The reading view can still edit the exact source it came from.
    assert_eq!(document.source, xml);
}

#[test]
fn a_heading_lent_by_the_file_name_is_marked_and_one_the_document_owns_is_not() {
    // The two are drawn identically, so the mark is the only thing that tells them apart — and it is what lets the app offer a rename on one of them and nothing on the other.
    let borrowed_xml =
        opened_document_from_xml("<urlset><url><loc>a</loc></url></urlset>", "sitemap.xml");
    assert_contains(
        &borrowed_xml.html,
        "<h1 data-borrowed-title id=\"sitemap\">Sitemap</h1>",
    );

    let owned_xml = opened_document_from_xml(
        "<feed><title>Daily notes</title><entry><id>1</id></entry></feed>",
        "sitemap.xml",
    );
    assert_contains(&owned_xml.html, ">Daily notes</h1>");
    assert!(
        !owned_xml.html.contains("data-borrowed-title"),
        "{}",
        owned_xml.html
    );

    // A data document's heading carries no source range either way, so the mark is the renderer stating the fact rather than anything the anchor could be read for.
    let borrowed_json = opened_document_from_json("{\"version\": 1}", "package.json");
    assert_contains(&borrowed_json.html, "data-borrowed-title");
    assert_contains(&borrowed_json.html, ">Package</h1>");

    let owned_json = opened_document_from_json(
        "{\"title\": \"Daily notes\", \"version\": 1}",
        "package.json",
    );
    assert_contains(&owned_json.html, ">Daily notes</h1>");
    assert!(
        !owned_json.html.contains("data-borrowed-title"),
        "{}",
        owned_json.html
    );
}

#[test]
fn tei_documents_keep_going_to_the_tei_renderer() {
    let xml = r#"<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt>
    <title type="mainTitle" xml:lang="en">The Work</title>
  </titleStmt></fileDesc></teiHeader>
  <text><body><div type="translation"><lg><l>A verse line.</l></lg></div></body></text>
</TEI>"#;

    let (title, html) = render_xml_body(xml);

    assert_eq!(title.as_deref(), Some("The Work"));
    // TEI-only markup, so the routing (not just the title) went to `tei.rs`.
    assert_contains(&html, "<blockquote class=\"tei-verse\">");
    assert!(!html.contains("data-fields"), "{html}");
}

#[test]
fn a_document_says_which_renderer_drew_it_so_the_page_can_offer_what_it_draws() {
    let tei = r#"<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>The Work</title></titleStmt></fileDesc></teiHeader>
  <text><body><div><head>One</head><p>A line.</p></div></body></text>
</TEI>"#;
    let sitemap = "<urlset><url><loc>https://leaftext.com/</loc></url></urlset>";

    assert_eq!(
        opened_document_from_xml(tei, "work.xml").dialect,
        Some("tei")
    );
    // Every other XML is drawn by the generic renderer, which has no dialect to name — and neither has a note.
    assert_eq!(
        opened_document_from_xml(sitemap, "sitemap.xml").dialect,
        None
    );
    assert_eq!(
        opened_document_from_markdown("# Note\n", "note.md").dialect,
        None
    );
}

#[test]
fn every_kind_the_xml_plus_offers_draws_as_the_kind_it_claims() {
    // Each source below is exactly what one entry of the plus's XML menu writes into a gap. An entry may only be offered once its source is drawn as the thing its label promises — offering one the renderer flattens is the fault this pins.
    let tei = r#"<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>The Work</title></titleStmt></fileDesc></teiHeader>
  <text><body><div type="translation">
    <p>A line.</p>
    <p>Typed words.</p>
    <div><head>New part</head></div>
    <l>A verse line.</l>
  </div></body></text>
</TEI>"#;

    let (_title, html) = render_xml_body(tei);

    assert_contains(&html, ">Typed words.</p>");
    assert_contains(&html, ">New part</h2>");
    assert_contains(
        &html,
        "<blockquote class=\"tei-verse\">\n<p>A verse line.</p>\n</blockquote>",
    );

    // The generic renderer heads a container by its labeling child, so a heading there is a section with a `<head>` in it and there is no other shape that draws as one.
    let generic = "<config><size>Large</size><section><head>New part</head></section></config>";

    let (_title, html) = render_xml_body(generic);

    assert_contains(&html, ">New part</h2>");
    assert_contains(&html, "<dt>Size</dt>");

    // Why the generic menu offers the neighbor's own tag and never a paragraph: an element with words in it and no elements under it is a value, and a value is drawn as a labeled field whatever it is called.
    let (_title, html) = render_xml_body("<config><size>Large</size><p>Typed words.</p></config>");

    assert_contains(&html, "<dt>P</dt>");
    assert!(!html.contains("<p data-block-id"), "{html}");
}

// ---------------------------------------------------------------------------
// JSON and YAML
// ---------------------------------------------------------------------------

#[test]
fn json_reads_its_shape_into_a_title_fields_a_list_and_a_table() {
    let (title, html, _blocks) = render_json_document(PACKAGE_JSON, Some("Package"));

    // A title-ish root key titles the document, and is then left out of the body so the same string isn't said twice.
    assert_eq!(title.as_deref(), Some("leaftext"));
    assert_contains(&html, ">leaftext</h1>");
    assert!(!html.contains("<dt>Name</dt>"), "{html}");

    // Consecutive scalar keys collapse into one labeled list, camelCase and shorthand names read as words, and `null` says nothing at all.
    assert_contains(&html, "<dl class=\"data-fields\">");
    assert_contains(&html, "<dt>Version</dt>");
    assert!(!html.contains("Description"), "{html}");

    // A nested object becomes a section; a whole-value URL links.
    assert_contains(&html, ">Repository</h2>");
    assert_contains(&html, "<dt>Link</dt>");
    assert_contains(&html, "<a href=\"https://github.com/x/y\">");

    // Scalar arrays list; repeated uniform records become one table, with the union of their keys as columns.
    assert_contains(&html, "<ul class=\"data-list\"");
    assert_contains(&html, "<li>markdown</li>");
    assert_contains(&html, "<table class=\"data-table\"");
    assert_contains(&html, "<thead><tr><th>Name</th><th>Email</th></tr></thead>");
    assert_contains(&html, "<tr><td>Ada</td><td>ada@example.com</td></tr>");
}

#[test]
fn json_blocks_anchor_to_the_exact_source_they_came_from() {
    let (_title, _html, blocks) = render_json_document(PACKAGE_JSON, None);

    assert!(!blocks.is_empty());
    // Every recorded range must slice out the value it was stamped on — the reader knows precisely where each JSON value starts and stops.
    let fields: Vec<&str> = blocks
        .iter()
        .filter(|block| block.kind == "data_field")
        .map(|block| &PACKAGE_JSON[block.start..block.end])
        .collect();
    assert!(fields.contains(&"\"0.1.380\""), "{fields:?}");
    assert!(fields.contains(&"true"), "{fields:?}");
    assert!(fields.contains(&"\"https://github.com/x/y\""), "{fields:?}");

    // The table's range covers every record in it.
    let table = blocks
        .iter()
        .find(|block| block.kind == "data_table")
        .expect("a record table");
    let slice = &PACKAGE_JSON[table.start..table.end];
    assert!(slice.starts_with('{') && slice.ends_with('}'), "{slice}");
    assert!(slice.contains("Ada") && slice.contains("Grace"), "{slice}");
}

#[test]
fn a_data_documents_own_title_heading_anchors_to_the_value_it_came_from() {
    // The title-ish key is left out of the body, so the heading is that value's only appearance on the page. Without a range on it, the one value a reader most wants to correct is the one thing on the page that answers a press with nothing.
    let json = r#"{"title": "Release notes", "version": "1.0"}"#;
    let (_title, html, blocks) = render_json_document(json, Some("Notes"));
    let heading = blocks
        .iter()
        .find(|block| block.kind == "data_heading")
        .expect("an anchored title heading");
    // A JSON string's range takes in its quotes, which is what a press on a JSON field opens today.
    assert_eq!(&json[heading.start..heading.end], "\"Release notes\"");
    let open = &html[html.find("<h1").expect("a heading")..];
    let open = &open[..open.find('>').expect("a closed tag")];
    assert!(
        open.contains(&format!("data-src-start=\"{}\"", heading.start)),
        "{open}"
    );

    // A YAML plain scalar proves its own words and nothing around them.
    let yaml = "title: Release notes
version: 1.0
";
    let (_title, _html, blocks) = render_yaml_document(yaml, Some("Notes"));
    let heading = blocks
        .iter()
        .find(|block| block.kind == "data_heading")
        .expect("an anchored title heading");
    assert_eq!(&yaml[heading.start..heading.end], "Release notes");

    // A quoted YAML title anchors on its quoted run, the way a JSON one does — the heading opens exactly the bytes the file holds.
    let quoted = "title: \"Release notes\"\nversion: 1.0\n";
    let (_title, html, blocks) = render_yaml_document(quoted, Some("Notes"));
    assert_contains(&html, ">Release notes</h1>");
    let heading = blocks
        .iter()
        .find(|block| block.kind == "data_heading")
        .expect("an anchored title heading");
    assert_eq!(&quoted[heading.start..heading.end], "\"Release notes\"");

    // A block scalar carries an indicator its value does not, so that heading stays unanchored rather than pointing at bytes nothing checked.
    let (_title, html, blocks) =
        render_yaml_document("title: |\n  Release notes\nversion: 1.0\n", Some("Notes"));
    assert_contains(&html, ">Release notes</h1>");
    assert!(
        !blocks.iter().any(|block| block.kind == "data_heading"),
        "{blocks:?}"
    );

    // A heading standing in for a title the document has not got names no value in the file, so it carries no range either.
    let (_title, html, blocks) = render_json_document(r#"{"version": "1.0"}"#, Some("Notes"));
    assert_contains(&html, ">Notes</h1>");
    assert!(
        !blocks.iter().any(|block| block.kind == "data_heading"),
        "{blocks:?}"
    );
}

#[test]
fn a_grouped_block_gets_a_range_only_when_every_member_has_one() {
    // A range narrower than the block it is stamped on is the dangerous case: the source editor would show one item, splice the edit over that item alone, and leave the reader thinking they had edited the whole list. A YAML flow sequence proves `macos` but not `windows,` (the comma trails it), so the list must carry no range at all.
    let yaml = "os: [windows, macos]\n";
    let (_title, html, blocks) = render_yaml_document(yaml, None);
    assert_contains(&html, "<li>windows</li>");
    assert_contains(&html, "<li>macos</li>");
    assert!(!html.contains("data-src-start"), "{html}");
    assert!(blocks.is_empty(), "{blocks:?}");

    // JSON knows every value's bounds, so the same list there spans all of it.
    let json = r#"{"os": ["windows", "macos"]}"#;
    let (_title, _html, blocks) = render_json_document(json, None);
    let list = blocks
        .iter()
        .find(|block| block.kind == "data_list")
        .expect("a list block");
    assert_eq!(&json[list.start..list.end], "\"windows\", \"macos\"");
}

#[test]
fn a_list_that_skipped_a_silent_item_carries_no_range() {
    // Same rule as the grouped-block case, from the other direction: `null` says nothing so it is not listed, which leaves the range reaching across source the block never showed. It gets none.
    let json = r#"{"os": ["windows", null, "macos"]}"#;
    let (_title, html, blocks) = render_json_document(json, None);

    assert_contains(&html, "<li>windows</li>");
    assert_contains(&html, "<li>macos</li>");
    assert_eq!(html.matches("<li>").count(), 2, "{html}");
    assert!(
        !blocks.iter().any(|block| block.kind == "data_list"),
        "{blocks:?}"
    );
}

#[test]
fn json_source_ranges_survive_multi_byte_text_above_them() {
    // The reader copies whole characters and advances by their UTF-8 width, so a value below non-ASCII text still anchors where it really sits. í is two bytes and € is three, so a character count would land short of the value.
    let json = "{\"título\": \"documento €\", \"shell\": \"bash\"}";

    let (_title, _html, blocks) = render_json_document(json, None);

    assert_eq!(blocks.len(), 2, "{blocks:?}");
    assert_eq!(&json[blocks[0].start..blocks[0].end], "\"documento €\"");
    assert_eq!(&json[blocks[1].start..blocks[1].end], "\"bash\"");
}

#[test]
fn json_string_escapes_decode_and_hostile_text_stays_inert() {
    // `🌿` is a surrogate pair — one character, not two lost halves.
    let json = r#"{"quote": "say \"hi\"", "leaf": "🌿", "html": "<script>x</script>"}"#;

    let (_title, html, _blocks) = render_json_document(json, None);

    assert_contains(&html, "say \"hi\"");
    assert_contains(&html, "🌿");
    // This body is never sanitized downstream — the renderer escapes as it writes, so markup in a value has to come out inert.
    assert_contains(&html, "&lt;script&gt;");
    assert!(!html.contains("<script>"), "{html}");
}

#[test]
fn a_malformed_unicode_escape_is_reported_not_guessed() {
    // `from_str_radix` accepts a leading sign, so this must be rejected on its own rather than read as 0x12f.
    let (_title, html, _blocks) = render_json_document(r#"{"a": "\u+12f"}"#, None);
    assert_contains(&html, "four hex digits");
}

#[test]
fn a_backslash_before_a_multi_byte_character_is_an_error_not_a_crash() {
    // The reader steps over a whole character after a backslash. Stepping one byte landed inside the emoji, and reporting the line from there sliced the source off a character boundary — opening the file took the window down.
    let (_title, html, blocks) = render_json_document("[\"\\🌀\"]", None);

    assert_contains(&html, "unknown string escape");
    assert!(blocks.is_empty(), "{blocks:?}");
}

#[test]
fn yaml_collections_carry_no_source_range_at_all() {
    // A block's range is spliced verbatim by the source editor, and nothing can prove where a YAML collection ends — its closing marker points at whatever token came next. So tables and lists built from YAML carry no range and stay read-only, while the plain scalars inside the same file keep theirs.
    let yaml = "steps:\n  - name: Checkout\n    uses: actions/checkout@v4\n  - name: Build\n    uses: actions/build@v1\n";

    let (_title, html, blocks) = render_yaml_document(yaml, None);

    // The table renders, but without offsets, so it is never source-edited.
    assert_contains(&html, "<table class=\"data-table\"");
    let table_tag = &html[html.find("<table").expect("a table")..];
    assert!(!table_tag[..table_tag.find('>').unwrap()].contains("data-src-start"));
    assert!(
        !blocks.iter().any(|block| block.kind == "data_table"),
        "{blocks:?}"
    );

    // Every range that *is* recorded slices out exactly the text it stands for.
    for block in &blocks {
        assert!(yaml.get(block.start..block.end).is_some(), "{block:?}");
    }
}

#[test]
fn json_reads_files_that_carry_comments_and_trailing_commas() {
    // `.json` files people actually open — tsconfig, editor settings — have both. Refusing to render them is the worse answer.
    let jsonc = r#"{
  // the compiler options
  "compilerOptions": {
    "strict": true, /* on purpose */
    "target": "es2022",
  },
}"#;

    let (_title, html, _blocks) = render_json_document(jsonc, Some("Tsconfig"));

    assert_contains(&html, ">Compiler options</h2>");
    assert_contains(&html, "<dt>Target</dt>");
    assert!(!html.contains("parse error"), "{html}");
}

#[test]
fn malformed_json_reports_the_line_rather_than_rendering_nothing() {
    let broken = "{\n  \"a\": 1,\n  \"b\": ,\n}";

    let (title, html, blocks) = render_json_document(broken, Some("Broken"));

    assert!(title.is_none(), "{title:?}");
    assert_contains(&html, "<strong>JSON parse error.</strong>");
    assert_contains(&html, "(line 3)");
    assert!(blocks.is_empty(), "{blocks:?}");
}

#[test]
fn yaml_resolves_aliases_and_splices_merge_keys() {
    let yaml = r#"defaults: &defaults
  shell: bash
  timeout: 10
jobs:
  build:
    <<: *defaults
    runs-on: windows-latest
"#;

    let (_title, html, _blocks) = render_yaml_document(yaml, Some("Workflow"));

    // `<<: *defaults` means "those pairs, here" — so the merged keys show up under Build, and no field is literally named `<<`.
    assert_contains(&html, ">Build</h3>");
    assert!(!html.contains("&lt;&lt;"), "{html}");
    let build = &html[html.find(">Build</h3>").expect("a build section")..];
    assert_contains(build, "<dt>Shell</dt>");
    assert_contains(build, "<dt>Timeout</dt>");
    assert_contains(build, "<dt>Runs on</dt>");
}

#[test]
fn an_alias_holds_the_anchors_value_but_not_its_place_in_the_file() {
    // `*x` is a reference; the text it stands for is up where `&x` is. Stamping both blocks with 6..11 meant editing `b` overwrote `a`'s value and left `*x` on the page untouched.
    let yaml = "a: &x hello\nb: *x\n";

    let (_title, html, blocks) = render_yaml_document(yaml, None);

    // Both fields show the value; only the anchor's carries offsets.
    assert_eq!(html.matches(">hello</dd>").count(), 2, "{html}");
    assert_eq!(html.matches("data-src-start").count(), 1, "{html}");
    assert_eq!(blocks.len(), 1, "{blocks:?}");
    assert_eq!(&yaml[blocks[0].start..blocks[0].end], "hello");
    assert_eq!(blocks[0].start, yaml.find("hello").expect("the anchor"));
}

#[test]
fn an_alias_to_a_mapping_claims_nothing_the_anchor_already_holds() {
    // A collection carries no range at its top but every scalar inside it does, so dropping only the alias's own range would leave the copied scalars pointing at the anchor's lines.
    let yaml = "base: &base\n  shell: bash\n  timeout: 10\ncopy: *base\n";

    let (_title, _html, blocks) = render_yaml_document(yaml, None);

    let mut ranges: Vec<_> = blocks
        .iter()
        .map(|block| (block.start, block.end))
        .collect();
    let claimed = ranges.len();
    ranges.sort_unstable();
    ranges.dedup();
    assert_eq!(ranges.len(), claimed, "{blocks:?}");
    // The anchor itself keeps its ranges — the strip is for the copy only.
    assert!(
        blocks
            .iter()
            .any(|block| &yaml[block.start..block.end] == "bash"),
        "{blocks:?}"
    );
}

#[test]
fn yaml_anchors_only_the_scalars_whose_range_it_can_prove() {
    let yaml = "plain: bash\nquoted: \"bash\"\nsingle: 'bash'\nblock: |\n  two\n  lines\n";

    let (_title, _html, blocks) = render_yaml_document(yaml, None);

    // A plain scalar's source is character-for-character its value, and a quoted one is that with its own quotes around it, so both get a range — the quotes are part of it, exactly as they are for a JSON string. A block scalar's source carries a `|` and an indent the value does not, so it gets none: an approximate range is worse than one that is simply absent.
    let sliced: Vec<&str> = blocks
        .iter()
        .map(|block| &yaml[block.start..block.end])
        .collect();
    assert_eq!(sliced, vec!["bash", "\"bash\"", "'bash'"], "{blocks:?}");
    assert_eq!(
        blocks[0].start,
        yaml.find("bash").expect("the plain scalar")
    );
}

#[test]
fn a_quoted_scalar_the_file_spells_another_way_keeps_no_range() {
    // The proof is one equality: the bytes between the quotes must be the value itself. An escape, a doubled quote and a fold across lines each break it, so every one is refused without being looked for — a range over an escape would splice a typed newline in where the file holds a backslash and an n.
    let ranged = |yaml: &str| {
        let (_title, html, blocks) = render_yaml_document(yaml, None);
        assert!(!html.contains("parse error"), "{html}");
        blocks.len()
    };
    // Written as a raw string so the backslash reaches YAML as one: the file holds a backslash and an n where the value holds a newline.
    let escaped = r#"escape: "a\nb"
"#;
    assert_eq!(ranged(escaped), 0);
    assert_eq!(ranged("doubled: 'it''s'\n"), 0);
    assert_eq!(ranged("folded:\n  \"one\n  two\"\n"), 0);

    // A value written as two quotes with nothing between them is not drawn at all, the way every empty value is, so its range never reaches the page and there is nothing there to press.
    let (_title, html, blocks) = render_yaml_document(
        "blank: \"\"
full: bash
",
        None,
    );
    assert!(!html.contains("<dt>Blank</dt>"), "{html}");
    assert_eq!(blocks.len(), 1, "{blocks:?}");
}

#[test]
fn a_key_with_no_value_carries_no_range_to_splice_into() {
    // The gap after `empty:` is a range of width nothing. Editing there would write `empty:x` — one scalar, not a key and a value — so the field stays read-only.
    let yaml = "empty:\nfull: bash\n";

    let (_title, _html, blocks) = render_yaml_document(yaml, None);

    assert_eq!(blocks.len(), 1, "{blocks:?}");
    assert_eq!(&yaml[blocks[0].start..blocks[0].end], "bash");
}

#[test]
fn yaml_source_ranges_are_byte_offsets_not_character_counts() {
    // The YAML scanner's markers count *characters*; every block range in the app is a byte offset. Without the conversion, any file with non-ASCII text above a value would anchor that value short of where it really sits.
    let yaml = "título: documento €\nshell: bash\n";

    let (_title, _html, blocks) = render_yaml_document(yaml, None);

    assert_eq!(blocks.len(), 2, "{blocks:?}");
    for block in &blocks {
        // A range that slices cleanly is a range measured in bytes.
        assert!(yaml.get(block.start..block.end).is_some(), "{block:?}");
    }
    assert_eq!(&yaml[blocks[0].start..blocks[0].end], "documento €");
    assert_eq!(&yaml[blocks[1].start..blocks[1].end], "bash");
}

#[test]
fn yaml_stream_of_several_documents_reads_as_a_list_of_them() {
    let yaml = "---\nkind: Service\nname: web\n---\nkind: Deployment\nname: api\n";

    let (_title, html, _blocks) = render_yaml_document(yaml, Some("Manifests"));

    // Two flat records of the same shape are a table, whether they arrived as one sequence or as two documents.
    assert_contains(&html, "<table class=\"data-table\"");
    assert_contains(&html, "<th>Kind</th>");
    assert_contains(&html, "<tr><td>Service</td><td>web</td></tr>");
    assert_contains(&html, "<tr><td>Deployment</td><td>api</td></tr>");
}

#[test]
fn malformed_yaml_reports_a_parse_error() {
    let broken = "a:\n  - one\n b: two\n";

    let (title, html, blocks) = render_yaml_document(broken, Some("Broken"));

    assert!(title.is_none(), "{title:?}");
    assert_contains(&html, "<strong>YAML parse error.</strong>");
    assert!(blocks.is_empty(), "{blocks:?}");
}

#[test]
fn deeply_nested_data_is_refused_rather_than_overflowing_the_stack() {
    // A reader that recurses on a hostile file is a crash, not a rendering problem, so both refuse depth far past anything a real document reaches. The JSON reader is ours and reports its own limit; YAML is refused by the parser's built-in recursion limit first, which is a good part of why a maintained and fuzzed crate was worth one dependency.
    let json = format!("{}1{}", "[".repeat(400), "]".repeat(400));
    let (title, html, blocks) = render_json_document(&json, None);
    assert_contains(&html, "nested too deeply");
    assert!(title.is_none() && blocks.is_empty());

    // Flow style, because indented dashes are one flat sequence holding a multi-line scalar rather than a nest.
    let yaml = format!("{}a{}", "[".repeat(400), "]".repeat(400));
    let (title, html, blocks) = render_yaml_document(&yaml, None);
    assert_contains(&html, "<strong>YAML parse error.</strong>");
    assert_contains(&html, "recursion limit exceeded");
    assert!(title.is_none() && blocks.is_empty());
}

#[test]
fn tei_block_map_anchors_paragraphs_and_headings_to_xml_ranges() {
    let xml = r#"<TEI><teiHeader><fileDesc><titleStmt>
        <title type="mainTitle" xml:lang="en">The Work</title>
        </titleStmt></fileDesc></teiHeader>
        <text><body>
        <div type="section"><head>A Section</head>
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
        </div>
        </body></text></TEI>"#;

    let spans = xml_block_source_map(xml);
    // Two headings — the document title and the section head — and two paragraphs, all editable.
    assert_eq!(
        spans
            .iter()
            .filter(|s| s.kind == "heading" && s.editable)
            .count(),
        2
    );
    assert_eq!(spans.iter().filter(|s| s.kind == "paragraph").count(), 2);
    // Ranges point at the real XML source for those nodes.
    for span in &spans {
        let slice = &xml[span.start..span.end];
        if span.kind == "paragraph" {
            assert!(
                slice.starts_with("<p>") && slice.ends_with("</p>"),
                "{slice}"
            );
        } else {
            assert!(
                (slice.starts_with("<head>") && slice.ends_with("</head>"))
                    || (slice.starts_with("<title") && slice.ends_with("</title>")),
                "{slice}"
            );
        }
    }
}

#[test]
fn a_tei_title_and_its_alternate_language_lines_are_anchored_to_their_own_title_elements() {
    // The title is the first line a reader meets and the one most likely to carry a typo, so it opens on a press like every other block rather than being drawn with no range at all.
    let xml = r#"<TEI><teiHeader><fileDesc><titleStmt>
        <title type="mainTitle" xml:lang="en">The Work</title>
        <title type="mainTitle" xml:lang="sa-ltn">Karya</title>
        <title type="longTitle" xml:lang="en">The Long Work</title>
        </titleStmt></fileDesc></teiHeader>
        <text><body><div><p>First paragraph.</p></div></body></text></TEI>"#;

    let spans = xml_block_source_map(xml);
    let heading = spans
        .iter()
        .find(|s| s.kind == "heading")
        .expect("the title is drawn as an anchored heading");
    assert!(heading.editable);
    assert_eq!(
        &xml[heading.start..heading.end],
        r#"<title type="mainTitle" xml:lang="en">The Work</title>"#
    );

    // The Sanskrit and long-title lines under it are drawn from their own elements, so they carry their own bytes rather than the main title's.
    let slices: Vec<&str> = spans
        .iter()
        .filter(|s| s.kind == "paragraph")
        .map(|s| &xml[s.start..s.end])
        .collect();
    assert!(
        slices.contains(&r#"<title type="mainTitle" xml:lang="sa-ltn">Karya</title>"#),
        "{slices:?}"
    );
    assert!(
        slices.contains(&r#"<title type="longTitle" xml:lang="en">The Long Work</title>"#),
        "{slices:?}"
    );

    // A header naming no title draws no heading at all — the file name titles the tab, never the page, and anchoring must not invent one.
    let untitled = r#"<TEI><teiHeader><fileDesc><titleStmt></titleStmt></fileDesc></teiHeader>
        <text><body><div><p>First paragraph.</p></div></body></text></TEI>"#;
    assert!(xml_block_source_map(untitled)
        .iter()
        .all(|s| s.kind != "heading"));
}

#[test]
fn a_comment_between_two_blocks_is_drawn_and_anchored_to_its_own_bytes() {
    // The same document in both dialects, since a comment nobody draws is a comment nobody can see in either.
    let tei = r#"<TEI><teiHeader><fileDesc><titleStmt><title>The Work</title></titleStmt></fileDesc></teiHeader>
        <text><body><div><head>A Section</head>
        <!-- checked against the manuscript -->
        <p>First paragraph.</p>
        </div></body></text></TEI>"#;
    let config = "<config><name>Widget</name>\n<!-- checked against the manuscript -->\n<timeout>30</timeout></config>";

    for source in [tei, config] {
        let (_title, html, blocks, _dialect) = render_xml_document(source, None);

        // Drawn as a fold saying what it is, with the comment's own words inside it and none of the file's punctuation on the page.
        assert_contains(&html, "<details class=\"xml-comment\"");
        assert_contains(
            &html,
            "<summary class=\"xml-comment-summary\">Comment</summary><div class=\"xml-comment-body\">checked against the manuscript</div>",
        );
        assert!(!html.contains("&lt;!--"), "{html}");
        // And anchored, which is what makes a click on it open its source.
        let comment = blocks
            .iter()
            .find(|span| span.kind == "comment")
            .expect("the comment carries a block of its own");
        assert_eq!(
            &source[comment.start..comment.end],
            "<!-- checked against the manuscript -->"
        );
        // Everything around it still draws: the comment ends the run it stands in rather than swallowing it. The scholarly document carries one block more — its title, anchored to the `<title>` element the words came from.
        assert_eq!(
            blocks.len(),
            if source == tei { 4 } else { 3 },
            "{blocks:?}"
        );
        assert_eq!(
            comment.id + 1,
            blocks.len() - 1,
            "the comment stands between the two blocks"
        );
    }
}

#[test]
fn opened_tei_document_stamps_inline_ranges_and_carries_source() {
    let xml = r#"<TEI><teiHeader><fileDesc><titleStmt>
        <title type="mainTitle" xml:lang="en">The Work</title>
        </titleStmt></fileDesc></teiHeader>
        <text><body>
        <div type="section"><head>A Section</head>
        <p>First paragraph.</p>
        </div>
        </body></text></TEI>"#;

    let document = opened_document_from_xml(xml, "doc.xml");
    assert_eq!(document.format, DocumentFormat::Xml);
    assert_eq!(document.source, xml); // XML edits its exact source
                                      // The rendered HTML carries inline source ranges the reader edits against.
    assert_contains(&document.html, "data-src-start=");
    assert_contains(&document.html, "data-editable=\"true\"");
    assert_contains(&document.html, "data-block-kind=\"paragraph\"");
    // And the block map agrees with what was stamped.
    assert!(!document.blocks.is_empty());
}
