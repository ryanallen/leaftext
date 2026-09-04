//! The test suite. Split by subject; helpers shared across those files live here.

use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

mod app_shell_chrome_bar;
mod app_shell_chrome_boot;
mod app_shell_chrome_export;
mod app_shell_chrome_icons;
mod app_shell_chrome_sheets;
mod app_shell_chrome_tabs;
mod app_shell_library_graph;
mod app_shell_library_pane;
mod app_shell_library_vaults;
mod app_shell_reader_document;
mod app_shell_reader_editing;
mod app_shell_reader_minimap;
mod app_shell_scripts;
mod code_documents;
mod code_intel;
mod conformance;
mod data_xml;
mod doc_graph;
mod editing;
mod eml;
mod encoding;
mod folder_tree;
mod git;
mod glossary;
mod html;
mod images;
mod indexer_pager;
mod ini;
mod known_folders;
mod markdown_code;
mod markdown_github;
mod markdown_rawhtml;
mod markdown_render;
mod minimap;
mod office;
mod png;
mod query;
mod reading_css_code_view;
mod reading_css_document;
mod reading_css_grain;
mod reading_css_layout;
mod reading_css_motion;
mod reading_css_parts;
mod reading_css_reader;
mod reading_css_tokens;
mod remote;
mod settings_paths;
mod site_protocol;
mod text;
mod theme_registry;
mod updater;
mod vault_corpus;
mod web_core;

#[derive(Debug, Clone, Copy)]
struct Rgb {
    red: f64,
    green: f64,
    blue: f64,
}

fn assert_contains(haystack: &str, needle: &str) {
    assert!(
        haystack.contains(needle),
        "expected rendered HTML to contain:\n{needle}\n\nrendered HTML:\n{haystack}"
    );
}

/// A pin that says where the line has to be. `assert_contains` reads the whole joined page, so a line lifted out of the function a test names and put in a helper still matches from wherever it landed and the test goes on passing while nothing holds what it says it holds. This reads only the block `opener` opens.
///
/// `opener` is the line as it is written in the fragment, bracket and all — a function's declaration, the callback handed to a listener, since an anonymous listener is declared by no name a helper could take, or the line that opens a list, since two lists holding one row is the same ambiguity.
fn assert_in(haystack: &str, opener: &str, needle: &str) {
    match block_opened_by(haystack, opener) {
        Err(why) => panic!("{why}"),
        Ok(block) => assert!(
            block.contains(needle),
            "expected\n{needle}\ninside\n{opener}\nbut it is {}\n\nthe block holds:\n{block}",
            if haystack.contains(needle) {
                "somewhere else in the page, so this test no longer holds the block it names"
            } else {
                "nowhere in the page at all"
            }
        ),
    }
}

/// The body of the block one line opens. The fragments are indented a level at a time, so the block ends at the first line closing at the opener's own indentation — a brace inside a string or a comment cannot end it early the way counting braces would.
///
/// An opener the page holds twice says nothing about which block is meant, so it is refused rather than resolved to the first.
fn block_opened_by<'a>(haystack: &'a str, opener: &str) -> Result<&'a str, String> {
    let closer = match opener.trim_end().chars().last() {
        Some('{') => '}',
        Some('[') => ']',
        _ => {
            return Err(format!(
                "an opener is the line that opens the block, bracket and all, and this one has none:\n{opener}"
            ));
        }
    };
    let places = haystack.matches(opener).count();
    if places != 1 {
        return Err(match places {
            0 => format!("the page holds no\n{opener}"),
            _ => format!(
                "the page holds\n{opener}\nin {places} places, so it does not say which block is meant"
            ),
        });
    }
    let at = haystack
        .find(opener)
        .expect("the one place was just counted");
    let line_start = haystack[..at].rfind('\n').map_or(0, |newline| newline + 1);
    let indent: String = haystack[line_start..at]
        .chars()
        .take_while(|character| character.is_whitespace())
        .collect();
    let body = &haystack[at + opener.len()..];
    body.find(&format!("\n{indent}{closer}"))
        .map(|end| &body[..end])
        .ok_or_else(|| format!("this never closes at its own indentation:\n{opener}"))
}

#[test]
fn a_scoped_pin_finds_a_line_inside_the_block_it_names() {
    let page = made_up_script();

    assert_in(&page, "function settle() {", "refresh();");
    // An anonymous listener has no name to be scoped by, so the line that registers it is the opener.
    assert_in(
        &page,
        "app.addEventListener('scroll', () => {",
        "schedule();",
    );
    // A nested block does not end the outer one.
    assert_in(&page, "function settle() {", "clamp();");
    // Two lists holding one row is the same ambiguity a function is, so a list opens a block too.
    assert_in(&page, "const FIRST_MENU = [", "{ action: 'open' },");
}

#[test]
fn a_scoped_pin_refuses_a_line_that_sits_outside_the_block_it_names() {
    let page = made_up_script();

    let block = block_opened_by(&page, "function settle() {").expect("the block is found");
    assert!(
        !block.contains("schedule();"),
        "the settle block should not reach into the scroll listener"
    );
    assert!(
        page.contains("schedule();"),
        "the line is in the page, which is what makes an unscoped pin pass"
    );
}

#[test]
#[should_panic(expected = "somewhere else in the page")]
fn a_scoped_pin_says_the_line_moved_rather_than_that_it_is_gone() {
    assert_in(&made_up_script(), "function settle() {", "schedule();");
}

#[test]
fn a_scoped_pin_refuses_an_opener_the_page_does_not_hold() {
    let page = made_up_script();

    let why = block_opened_by(&page, "function gone() {").expect_err("the opener is not there");
    assert!(
        why.contains("holds no"),
        "the refusal should say the opener is missing, got: {why}"
    );
    // Two blocks opened by one line say nothing about which is meant, so that is refused too.
    let why = block_opened_by(&page, "if (ready) {").expect_err("the opener is in two places");
    assert!(
        why.contains("in 2 places"),
        "the refusal should count the places, got: {why}"
    );
}

/// A page of the shape the fragments have: a function, a nested block, an anonymous listener, two lists holding one row, and one opener in two places.
fn made_up_script() -> String {
    [
        "function settle() {\n",
        "  if (ready) {\n    clamp();\n  }\n",
        "  refresh();\n}\n",
        "app.addEventListener('scroll', () => {\n",
        "  if (ready) {\n    schedule();\n  }\n",
        "});\n",
        "const FIRST_MENU = [\n  { action: 'open' },\n];\n",
        "const OTHER_MENU = [\n  { action: 'open' },\n];\n",
    ]
    .concat()
}

/// The page and the front-end script together. The script is served as `app.js` rather than inlined, so a test that asserts on both has to be handed both — one string, in load order, which is what the web view ends up with anyway.
fn app_shell_page() -> String {
    format!(
        "{}
{}",
        app_shell_html(),
        app_shell_script()
    )
}

/// An icon reaches the page as a name, not a drawing: the element carries `lt-icon lt-icon-<name>` and the stylesheet holds the mask. Both halves are checked, because either alone draws nothing.
fn assert_icon(html: &str, name: &str) {
    assert!(
        html.contains(&format!("lt-icon lt-icon-{name}")),
        "expected the page to wear the {name} icon"
    );
    let css = reading_mode_css();
    assert!(
        css.contains(&format!(".lt-icon-{name} {{")),
        "the stylesheet has no .lt-icon-{name} to draw"
    );
}

/// The same CSS with every `/* … */` taken out, so a rule's selector can be read off its head without a comment standing in the way — every rule in this stylesheet is introduced by one.
fn strip_css_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(at) = rest.find("/*") {
        out.push_str(&rest[..at]);
        rest = match rest[at..].find("*/") {
            Some(end) => &rest[at + end + 2..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// The whole line a byte sits on, so a refusal can show the rule that was matched instead of the one that was asked for.
fn line_holding(text: &str, at: usize) -> &str {
    let start = text[..at].rfind('\n').map_or(0, |newline| newline + 1);
    let end = text[at..]
        .find('\n')
        .map_or(text.len(), |newline| at + newline);
    &text[start..end]
}

/// Which line of the text a byte sits on, counting from one. Two rules opened by one selector are the same words twice, so the line number is what tells a refusal's reader which is which.
fn line_number(text: &str, at: usize) -> usize {
    text[..at].matches('\n').count() + 1
}

/// The first thing a rule declares, read off what follows its selector — what a caller carries to say which of two rules with one selector they mean, so a refusal hands it over rather than sending them to look. The comments come out first: every rule here is introduced by one, and a paragraph of prose is not something anybody can quote back.
fn first_declaration(after_selector: &str) -> String {
    strip_css_comments(after_selector)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("nothing")
        .to_string()
}

/// Where the one rule a selector opens begins. Everything that locates a rule reads through this — its declarations, and where it sits against another rule — so there is one anchored find rather than a second one hand-written beside it.
///
/// The selector is the head of the line the rule opens on, indent and all: a match counts only where it begins what was handed in or sits straight after a newline. Matched as a plain substring it answered with any rule merely *ending* with the one asked for — `.reader-toolbar {` came back out of `body.is-embedded .reader-toolbar {` with `display: none`. A selector opening two rules says nothing about which is meant, so it is refused rather than resolved to the first; carrying the declaration that tells them apart is how a caller says which.
fn rule_at(css: &str, selector: &str) -> usize {
    let opens = rule_opens(css, selector);
    match opens.as_slice() {
        [only] => *only,
        [] => match css.find(selector) {
            Some(at) => panic!(
                "no rule opens with {selector}; it is only ever part of a longer line, first this one:\n{}",
                line_holding(css, at)
            ),
            None => panic!("the stylesheet should define {selector}"),
        },
        _ => panic!(
            "{selector} opens {} rules, so it does not say which one is meant. Name the declaration that tells them apart:\n{}",
            opens.len(),
            opens
                .iter()
                .map(|at| format!(
                    "line {}, then {}",
                    line_number(css, *at),
                    first_declaration(&css[at + selector.len()..])
                ))
                .collect::<Vec<_>>()
                .join("\n")
        ),
    }
}

/// Every line start a selector opens a rule on, in source order. The one anchored find in the suite: `rule_at` narrows it to the single match a caller naming one rule means, and `rule_bodies` reads all of them.
fn rule_opens(css: &str, selector: &str) -> Vec<usize> {
    css.match_indices(selector)
        .map(|(at, _)| at)
        .filter(|at| *at == 0 || css.as_bytes()[at - 1] == b'\n')
        .collect()
}

/// The declarations of every rule a selector opens, each to its own first closing brace, empty where it opens none. For the caller that composes a selector and has to carry on when the stylesheet says nothing: a class with no rule is an answer there, and a class with two is two rules that both have to be looked at.
fn rule_bodies<'a>(css: &'a str, selector: &str) -> Vec<&'a str> {
    rule_opens(css, selector)
        .into_iter()
        .map(|at| {
            let body = &css[at..];
            &body[..body.find('}').expect("the rule should close")]
        })
        .collect()
}

/// One rule's declarations, from its selector to the first closing brace. The compiled stylesheet has no nested rules, so the first `}` is always the end.
fn rule_body<'a>(css: &'a str, selector: &str) -> &'a str {
    let body = &css[rule_at(css, selector)..];
    &body[..body.find('}').expect("the rule should close")]
}

/// Every icon name `design/icons.md` holds, in the order its table holds them.
fn icon_rows() -> Vec<String> {
    include_str!("../../design/icons.md")
        .lines()
        .filter(|line| line.starts_with('|'))
        .filter_map(|line| {
            let cells: Vec<&str> = line.split('|').map(str::trim).collect();
            let name = cells.get(1).copied().unwrap_or_default();
            let file = cells.get(2).copied().unwrap_or_default();
            (file.ends_with(".svg") && !name.is_empty()).then(|| name.to_string())
        })
        .collect()
}

fn local_img(path: &str) -> String {
    local_image_webview_url(path)
}

fn expected_img(src: &str, attributes: &str) -> String {
    format!(r#"<img src="{}" {}>"#, local_img(src), attributes)
}

fn fixture_source_path(relative_path: &str) -> PathBuf {
    std::env::temp_dir()
        .join("leaf-render-fixtures")
        .join(relative_path)
}

/// A scratch folder of this test's own, created. The label says which test asked, this process's id says which run, and the counter separates two asked for in one instant — a clock says none of the three, because it ticks slowly enough here to hand two tests that start together the same folder.
pub(crate) fn scratch_dir(label: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "leaf-{label}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    fs::create_dir_all(&dir).expect("scratch directory is created");
    dir
}

pub(crate) fn link_dir(link: &Path, target: &Path) {
    #[cfg(windows)]
    {
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .expect("mklink runs");
        assert!(
            made.status.success(),
            "a junction is made without elevation"
        );
    }
    #[cfg(not(windows))]
    std::os::unix::fs::symlink(target, link).expect("symlink created");
}

#[test]
fn a_scratch_folder_is_named_for_its_test_and_for_the_run_that_asked_for_it() {
    // Handed in rather than written into the call, so the check that refuses one word twice reads only real call sites.
    let label = "mod-scratch-one";
    let one = scratch_dir(label);
    let other = scratch_dir("mod-scratch-other");
    let again = scratch_dir(label);

    assert_ne!(one, other, "two labels are two folders");
    assert_ne!(
        one, again,
        "one label asked for twice is two folders, so a test that wants a second one gets a second one"
    );
    let run = std::process::id().to_string();
    for dir in [&one, &other, &again] {
        assert!(dir.is_dir(), "{} was not made", dir.display());
        assert!(
            dir.to_string_lossy().contains(&run),
            "{} does not say which run asked for it, so two runs at once would share it",
            dir.display()
        );
    }

    for dir in [one, other, again] {
        let _ = fs::remove_dir_all(dir);
    }
}

fn expected_base_href(source_path: &Path) -> String {
    source_path
        .parent()
        .and_then(|parent| Url::from_directory_path(parent).ok())
        .map(|url| format!(r#"<base href="{}">"#, encode_text(url.as_str())))
        .expect("fixture source path has a file URL")
}

fn file_url_for_fixture(relative_path: &str) -> String {
    Url::from_file_path(fixture_source_path(relative_path))
        .expect("fixture path has a file URL")
        .to_string()
}

fn absolute_path_destination_for_fixture(relative_path: &str) -> String {
    fixture_source_path(relative_path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn tiny_png_bytes() -> &'static [u8] {
    &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]
}

fn css_token(css: &str, theme: ResolvedTheme, name: &str) -> Rgb {
    let leaf_alias_block = css_block(css, ":root {");
    let mut blocks = vec![leaf_alias_block];
    // The `:root` aliases point at `--lt-*` tokens defined in the github family block, which hold concrete hex. Load it so the var() chain resolves for the default theme.
    let family_block = match theme {
        ResolvedTheme::Light => {
            r#":root[data-leaf-theme="github"][data-leaf-appearance="light"] {"#
        }
        ResolvedTheme::Dark => r#":root[data-leaf-theme="github"][data-leaf-appearance="dark"] {"#,
    };
    blocks.extend(css_blocks(css, family_block));
    let value = css_token_value(&blocks, name);

    parse_hex_color(&value)
        .or_else(|| {
            let background = css_token_value(&blocks, "--lt-background");
            parse_hex_color(&background)
                .and_then(|background| parse_hex_color_with_alpha(&value, background))
        })
        .unwrap_or_else(|| panic!("expected {name} to resolve to a hex color"))
}

fn css_token_for_source(css: &str, source: &ThemeSource, name: &str) -> Rgb {
    let blocks = css_blocks(css, &format!("{} {{", source.selector));
    let value = css_token_value(&blocks, name);

    parse_hex_color(&value)
        .or_else(|| {
            let background = css_token_value(&blocks, "--lt-background");
            parse_hex_color(&background)
                .and_then(|background| parse_hex_color_with_alpha(&value, background))
        })
        .unwrap_or_else(|| panic!("expected {} {name} to resolve to a hex color", source.id))
}

fn css_block<'a>(css: &'a str, selector: &str) -> &'a str {
    css_blocks(css, selector)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("expected CSS block {selector}"))
}

fn css_blocks<'a>(css: &'a str, selector: &str) -> Vec<&'a str> {
    css.split(selector)
        .skip(1)
        .filter_map(|rest| rest.split_once("\n}").map(|(block, _)| block))
        .collect()
}

fn css_token_value(blocks: &[&str], name: &str) -> String {
    let declaration = blocks
        .iter()
        .flat_map(|block| block.lines())
        .map(str::trim)
        .find(|line| line.starts_with(name))
        .unwrap_or_else(|| panic!("expected CSS token {name} in theme block"));
    let value = declaration
        .split_once(':')
        .and_then(|(_, value)| value.trim().split_once(';').map(|(value, _)| value.trim()))
        .unwrap_or_else(|| panic!("expected CSS declaration value for {name}"));

    if let Some(alias) = value
        .strip_prefix("var(")
        .and_then(|value| value.strip_suffix(')'))
    {
        return css_token_value(blocks, alias).to_string();
    }

    value.to_string()
}

fn parse_hex_color(value: &str) -> Option<Rgb> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    Some(Rgb {
        red: u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0,
        green: u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0,
        blue: u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0,
    })
}

fn parse_hex_color_with_alpha(value: &str, background: Rgb) -> Option<Rgb> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 8 {
        return None;
    }
    let foreground = Rgb {
        red: u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0,
        green: u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0,
        blue: u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0,
    };
    let alpha = u8::from_str_radix(&hex[6..8], 16).ok()? as f64 / 255.0;

    Some(Rgb {
        red: foreground.red * alpha + background.red * (1.0 - alpha),
        green: foreground.green * alpha + background.green * (1.0 - alpha),
        blue: foreground.blue * alpha + background.blue * (1.0 - alpha),
    })
}

fn contrast_ratio(foreground: Rgb, background: Rgb) -> f64 {
    let foreground = relative_luminance(foreground);
    let background = relative_luminance(background);
    let (lighter, darker) = if foreground >= background {
        (foreground, background)
    } else {
        (background, foreground)
    };

    (lighter + 0.05) / (darker + 0.05)
}

fn relative_luminance(color: Rgb) -> f64 {
    fn linearize(channel: f64) -> f64 {
        if channel <= 0.03928 {
            channel / 12.92
        } else {
            ((channel + 0.055) / 1.055).powf(2.4)
        }
    }

    0.2126 * linearize(color.red) + 0.7152 * linearize(color.green) + 0.0722 * linearize(color.blue)
}

fn assert_contrast_at_least(
    css: &str,
    theme: ResolvedTheme,
    foreground: &str,
    background: &str,
    minimum: f64,
) {
    let ratio = contrast_ratio(
        css_token(css, theme, foreground),
        css_token(css, theme, background),
    );
    assert!(
            ratio >= minimum,
            "expected {theme:?} {foreground} on {background} contrast {ratio:.2} to be at least {minimum:.1}"
        );
}

const PACKAGE_JSON: &str = r#"{
  "name": "leaftext",
  "version": "0.1.380",
  "private": true,
  "description": null,
  "keywords": ["markdown", "reader"],
  "repository": { "type": "git", "url": "https://github.com/x/y" },
  "contributors": [
    { "name": "Ada", "email": "ada@example.com" },
    { "name": "Grace", "email": "grace@example.com" }
  ]
}"#;

fn blake3_hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
