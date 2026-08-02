//! The test suite. Split by subject; helpers shared across those files live here.

use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

mod app_shell_chrome;
mod app_shell_library;
mod app_shell_reader;
mod app_shell_scripts;
mod code_intel;
mod data_xml;
mod doc_graph;
mod editing;
mod eml;
mod encoding;
mod folder_tree;
mod git;
mod glossary;
mod images;
mod indexer_pager;
mod markdown_code;
mod markdown_github;
mod markdown_rawhtml;
mod markdown_render;
mod minimap;
mod png;
mod reading_css;
mod settings_paths;
mod theme_registry;
mod updater;
mod vault_corpus;

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

/// One rule's declarations, from its selector to the first closing brace. The
/// compiled stylesheet has no nested rules, so the first `}` is always the end.
fn rule_body<'a>(css: &'a str, selector: &str) -> &'a str {
    let start = css
        .find(selector)
        .unwrap_or_else(|| panic!("the stylesheet should define {selector}"));
    let body = &css[start..];
    &body[..body.find('}').expect("the rule should close")]
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
    // The `:root` aliases point at `--leaf-*` tokens defined in the github family
    // block, which hold concrete hex. Load it so the var() chain resolves for the
    // default theme.
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
            let background = css_token_value(&blocks, "--leaf-background");
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
            let background = css_token_value(&blocks, "--leaf-background");
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
