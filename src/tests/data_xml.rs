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
    assert_contains(
        &html,
        "<p class=\"tei-doc-subtitle\"><em>Pravrajyāvastu</em></p>",
    );
    assert_contains(
        &html,
        "<p class=\"tei-doc-subtitle\"><em>Vinayavastu Pravrajyāvastu</em></p>",
    );
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
    assert_contains(
        &html,
        "<td><a href=\"https://leaftext.com/\">https://leaftext.com/</a></td><td>2026-07-24</td>",
    );
    // And nothing of the TEI renderer's leaks through.
    assert!(!html.contains("No TEI body"), "{html}");
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
  <author><name>Ada</name><email>ada@example.org</email></author>
</feed>"#;

    let (_title, html) = render_xml_body(xml);

    // An empty element with one attribute shows that attribute as its value, unlabeled — the element's own label already names it. (Match around the inline source-range attributes.)
    assert_contains(&html, "<dt>Link</dt><dd data-block-id=");
    assert_contains(
        &html,
        "<a href=\"http://example.org/\">http://example.org/</a></dd>",
    );
    assert!(!html.contains("Link: <a"), "{html}");
    // A section named by a `<name>` child is qualified by its tag, so a person's name doesn't read as a section title on its own.
    assert_contains(&html, ">Author: Ada</h2>");
}

#[test]
fn generic_xml_blocks_anchor_to_their_source_elements() {
    let xml = "<config><name>Widget</name><timeout>30</timeout>\
               <note>Some prose with <b>markup</b> in it.</note></config>";

    let (_title, html, blocks) = render_xml_document(xml, None);

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
    assert_contains(&document.html, "<h1 id=\"sitemap\">Sitemap</h1>");
    // The reading view can still edit the exact source it came from.
    assert_eq!(document.source, xml);
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
    let yaml = "plain: bash\nquoted: \"bash\"\nblock: |\n  two\n  lines\n";

    let (_title, _html, blocks) = render_yaml_document(yaml, None);

    // A plain scalar's source is character-for-character its value, so it gets a range. A quoted or block scalar's source carries quotes or a `|` that the value does not, so it gets none — an approximate range is worse than one that is simply absent.
    assert_eq!(blocks.len(), 1, "{blocks:?}");
    assert_eq!(&yaml[blocks[0].start..blocks[0].end], "bash");
    assert_eq!(
        blocks[0].start,
        yaml.find("bash").expect("the plain scalar")
    );
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
    // One heading (the section head) and two paragraphs, all editable.
    assert!(spans.iter().any(|s| s.kind == "heading" && s.editable));
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
                slice.starts_with("<head>") && slice.ends_with("</head>"),
                "{slice}"
            );
        }
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
