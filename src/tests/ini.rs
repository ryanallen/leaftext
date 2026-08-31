use super::*;

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
