use super::*;
use std::ops::Range;

/// Every rule of the dialect in one file: both comment characters, a `#` inside a value, a key written before any section, a repeated key, a repeated section, a value carrying an `=`, a quoted value, a `[` inside a value, and a line that is not a pair at all.
const DIALECT: &str = "; a comment
# another comment
editor = leaftext

[display]
font_size = 14
url = https://example.com/page#anchor
theme =
quoted = \"kept\"
pattern = [a-z]+
command = run --flag=1
font_size = 16

[display]
color = #ff8800

[paths]
  ; an indented comment
  home = C:\\Users\\rwall
loose line with no equals
";

#[test]
fn ini_opens_as_ini() {
    let path = PathBuf::from("settings.ini");
    assert_eq!(DocumentFormat::for_path(&path), Some(DocumentFormat::Ini));
    assert_eq!(DocumentFormat::from_path(&path), DocumentFormat::Ini);
    assert_eq!(
        DocumentFormat::from_path(Path::new("SETTINGS.INI")),
        DocumentFormat::Ini
    );
    assert_eq!(DocumentFormat::Ini.display_name(), "INI");
    assert_eq!(DocumentFormat::Ini.language_token(), "ini");
}

#[test]
fn every_rule_of_the_dialect_is_drawn_as_written() {
    let document = opened_document_from_source(DIALECT, "settings.ini");
    let html = &document.html;

    // A section opens a heading; a repeated one opens a second heading rather than being folded in.
    assert_eq!(html.matches("<h2").count(), 3);
    assert_contains(html, ">display</h2>");
    assert_contains(html, ">paths</h2>");

    // A key written before the first section is drawn at the top, under no heading.
    let first_heading = html.find("<h2").expect("the file has sections");
    assert!(
        html[..first_heading].contains(">editor</dt><dd"),
        "a key before the first section was not drawn at the top:\n{html}"
    );

    // Every value as typed: nothing unquoted, nothing unescaped, nothing split on a later `=`.
    for (key, value) in [
        ("editor", "leaftext"),
        ("font_size", "14"),
        ("pattern", "[a-z]+"),
        ("command", "run --flag=1"),
        ("color", "#ff8800"),
        ("home", "C:\\Users\\rwall"),
    ] {
        assert!(
            html.contains(&format!(">{key}</dt><dd")),
            "{key} is not drawn:\n{html}"
        );
        assert!(
            html.contains(value),
            "{key}'s value is not {value}:\n{html}"
        );
    }
    // A quoted value keeps its quotes: nothing is unquoted on the way to the page.
    assert_contains(html, ">\"kept\"</dd>");

    // A `#` inside a value is part of the value, not the start of a comment.
    assert_contains(html, "https://example.com/page#anchor");

    // A repeated key draws twice, in order.
    assert!(
        html.contains(">14<") && html.contains(">16<"),
        "html:\n{html}"
    );

    // No comment is drawn, and neither is the empty value.
    for absent in ["a comment", "another comment", "an indented comment"] {
        assert!(!html.contains(absent), "a comment was drawn:\n{html}");
    }
    assert!(
        !html.contains(">theme</dt>"),
        "an empty value was drawn as a field:\n{html}"
    );

    // A line that is not a pair is drawn as a value with no name, rather than disappearing.
    assert_contains(html, "<dt></dt><dd");
    assert_contains(html, "loose line with no equals");
}

#[test]
fn every_value_carries_the_bytes_it_came_from() {
    let root = parse_ini(DIALECT);
    let DataValue::Mapping(pairs) = &root.value else {
        panic!("an INI file is a mapping");
    };

    let mut checked = 0;
    fn walk(pairs: &[(String, DataNode)], source: &str, checked: &mut usize) {
        for (_, node) in pairs {
            match &node.value {
                DataValue::Mapping(inner) => walk(inner, source, checked),
                DataValue::Scalar(text) => {
                    let Some(span) = node.span.clone() else {
                        assert!(text.is_empty(), "a value with no range: {text}");
                        continue;
                    };
                    assert_eq!(&source[span], text, "a range that is not its own value");
                    *checked += 1;
                }
                DataValue::Sequence(_) => panic!("an INI file has no sequences"),
            }
        }
    }
    walk(pairs, DIALECT, &mut checked);
    assert_eq!(checked, 10, "every value but the empty one carries a range");
}

#[test]
fn ini_key_ranges_name_only_the_drawn_keys() {
    let root = parse_ini(DIALECT);
    let DataValue::Mapping(pairs) = &root.value else {
        panic!("an INI file is a mapping");
    };

    let mut scalar_keys = Vec::new();
    fn collect(
        pairs: &[(String, DataNode)],
        source: &str,
        scalar_keys: &mut Vec<(String, Range<usize>)>,
    ) {
        for (key, node) in pairs {
            match &node.value {
                DataValue::Mapping(inner) => collect(inner, source, scalar_keys),
                DataValue::Scalar(_) => {
                    if key.is_empty() {
                        assert!(node.key_span.is_none(), "an empty key carried a range");
                        continue;
                    }
                    let span = node.key_span.clone().expect("a key's own range");
                    assert_eq!(&source[span.clone()], key, "a range around a key");
                    scalar_keys.push((key.clone(), span));
                }
                DataValue::Sequence(_) => panic!("an INI file has no sequences"),
            }
        }
    }
    collect(pairs, DIALECT, &mut scalar_keys);

    let font_sizes: Vec<_> = scalar_keys
        .iter()
        .filter(|(key, _)| key == "font_size")
        .map(|(_, span)| span.clone())
        .collect();
    assert_eq!(font_sizes.len(), 2, "the repeated key keeps both ranges");
    assert_ne!(
        font_sizes[0], font_sizes[1],
        "the repeated keys share a range"
    );

    let ini = opened_document_from_source(DIALECT, "settings.ini");
    for (key, span) in &scalar_keys {
        if key == "theme" {
            continue;
        }
        assert_contains(
            &ini.html,
            &format!(
                "<dt data-src-start=\"{}\" data-src-end=\"{}\">{key}</dt>",
                span.start, span.end
            ),
        );
    }
    assert!(!ini.html.contains(">theme</dt>"), "{}", ini.html);

    let json = opened_document_from_source("{ \"lastBuildDate\": 1 }", "settings.json");
    let label = json
        .html
        .find(">Last built</dt>")
        .expect("the humanized label");
    let open = &json.html[json.html[..label].rfind("<dt").expect("the label tag")..label];
    assert!(!open.contains("data-src-start"), "{open}");
}

#[test]
fn stripping_a_data_node_drops_key_ranges_too() {
    let mut root = parse_ini(DIALECT);
    root.strip_spans();

    fn assert_clear(node: &DataNode) {
        assert!(
            node.key_span.is_none(),
            "a copied key kept its source range"
        );
        assert!(node.span.is_none(), "a copied value kept its source range");
        match &node.value {
            DataValue::Scalar(_) => {}
            DataValue::Sequence(items) => items.iter().for_each(assert_clear),
            DataValue::Mapping(pairs) => {
                pairs.iter().for_each(|(_, value)| assert_clear(value));
            }
        }
    }
    assert_clear(&root);
}

#[test]
fn ini_section_ranges_name_only_the_drawn_sections() {
    let root = parse_ini(DIALECT);
    let DataValue::Mapping(pairs) = &root.value else {
        panic!("an INI file is a mapping");
    };
    let sections: Vec<_> = pairs
        .iter()
        .filter(|(_, node)| matches!(&node.value, DataValue::Mapping(_)))
        .map(|(name, node)| {
            let span = node.key_span.clone().expect("the section name's range");
            assert_eq!(
                &DIALECT[span.clone()],
                name,
                "a range around a section name"
            );
            (name, span)
        })
        .collect();
    let displays: Vec<_> = sections
        .iter()
        .filter(|(name, _)| *name == "display")
        .map(|(_, span)| span.clone())
        .collect();
    assert_eq!(displays.len(), 2, "the repeated section keeps both ranges");
    assert_ne!(
        displays[0], displays[1],
        "the repeated sections share a range"
    );

    let ini = opened_document_from_source(DIALECT, "settings.ini");
    for (name, span) in sections {
        assert_contains(
            &ini.html,
            &format!(
                "<h2 data-src-start=\"{}\" data-src-end=\"{}\"",
                span.start, span.end
            ),
        );
        assert_contains(&ini.html, &format!(">{name}</h2>"));
    }

    for (source, path) in [
        ("{ \"group\": { \"item\": 1 } }", "settings.json"),
        ("group:\n  item: 1\n", "settings.yaml"),
    ] {
        let document = opened_document_from_source(source, path);
        let label = document
            .html
            .find(">Group</h2>")
            .expect("the nested heading");
        let open = &document.html[document.html[..label]
            .rfind("<h2")
            .expect("the heading tag")..label];
        assert!(!open.contains("data-src-start"), "{open}");
    }
}

/// A config file's keys are names the person who wrote the file chose, so they are drawn as typed. The shared helper would spell `url` "Link" and `id` "ID", and sentence-case the rest.
#[test]
fn an_ini_key_keeps_its_own_spelling_and_a_json_key_does_not() {
    let ini = opened_document_from_source(
        "[editor]\nfont_size = 14\nurl = https://example.com\nid = 7\n",
        "settings.ini",
    );
    assert_contains(&ini.html, ">font_size</dt>");
    assert_contains(&ini.html, ">url</dt>");
    assert_contains(&ini.html, ">id</dt>");
    for humanized in [">Font size</dt>", ">Link</dt>", ">ID</dt>"] {
        assert!(
            !ini.html.contains(humanized),
            "an INI key was relabeled:\n{}",
            ini.html
        );
    }

    // The same keys in a JSON file keep the labels they have always drawn.
    let json = opened_document_from_source(
        "{ \"font_size\": 14, \"url\": \"https://example.com\", \"id\": 7 }",
        "settings.json",
    );
    assert_contains(&json.html, ">Font size</dt>");
    assert_contains(&json.html, ">Link</dt>");
    assert_contains(&json.html, ">ID</dt>");
}

/// A file that is not INI at all still puts everything it holds on the page: there is no parse to fail, so every line is drawn as a value with no name rather than as an error.
#[test]
fn a_file_that_is_not_ini_still_renders() {
    let document = opened_document_from_source(
        "The quick brown fox\njumped over the lazy dog.\n",
        "prose.ini",
    );
    assert_contains(&document.html, "The quick brown fox");
    assert_contains(&document.html, "jumped over the lazy dog.");
    assert!(!document.html.contains("could not be read"));
}

#[test]
#[ignore = "release-build measurement"]
fn measure_one_megabyte_ini_render() {
    let section = "[section]\nfont_size = 14\nurl = https://example.com/page\ncolor = #ff8800\n";
    let mut source = String::new();
    while source.len() + section.len() <= 1024 * 1024 {
        source.push_str(section);
    }
    let started = std::time::Instant::now();
    let document = opened_document_from_source(&source, "one-megabyte.ini");
    let elapsed = started.elapsed();
    assert_contains(&document.html, "font_size");
    eprintln!(
        "1 MB INI render: {elapsed:?} ({} source bytes)",
        source.len()
    );
}
