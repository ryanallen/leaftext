use crate::*;

pub(crate) const BACK_ICON_SVG: &str = include_str!("assets/arrow-left.svg");
pub(crate) const FORWARD_ICON_SVG: &str = include_str!("assets/arrow-right.svg");
pub(crate) const SETTINGS_ICON_SVG: &str = include_str!("assets/adjustments-vertical.svg");
pub(crate) const OPEN_LIBRARY_ICON_SVG: &str = include_str!("assets/panel.svg");
pub(crate) const OPEN_ICON_SVG: &str = include_str!("assets/folder-open.svg");
pub(crate) const CODE_VIEW_ICON_SVG: &str = include_str!("assets/code-bracket.svg");
pub(crate) const DOCUMENT_ICON_SVG: &str = include_str!("assets/document.svg");
// The one copy of the leaf mark. Both the header logomark and the library's
// per-file badge inline this same glyph, so it takes the theme color from
// `currentColor` at each site instead of carrying a color of its own.
pub(crate) const LEAF_ICON_SVG: &str = include_str!("assets/leaf.svg");
pub(crate) const FOOTNOTE_BACKREF_ICON_SVG: &str = include_str!("assets/arrow-uturn-left.svg");

// Bundled runtimes (mermaid, KaTeX, graph libs) compiled into the binary and
// served over a custom protocol, so math/diagrams render offline. Loaded
// lazily by the page only when a document needs them.
pub const LOCAL_ASSET_PROTOCOL: &str = "leaf-asset";
pub(crate) const MERMAID_JS: &[u8] = include_bytes!("assets/vendor/mermaid.min.js");
// PixiJS (WebGL) + d3-force power the library graph view.
pub(crate) const PIXI_JS: &[u8] = include_bytes!("assets/vendor/pixi.min.js");
// Pixi compiles shaders with `new Function`, which the CSP forbids (no
// 'unsafe-eval'). This official companion swaps those paths for eval-free
// polyfills so the graph renders without loosening the CSP.
pub(crate) const PIXI_UNSAFE_EVAL_JS: &[u8] =
    include_bytes!("assets/vendor/pixi-unsafe-eval.min.js");
pub(crate) const D3_FORCE_JS: &[u8] = include_bytes!("assets/vendor/d3-force.min.js");
pub(crate) const KATEX_JS: &[u8] = include_bytes!("assets/vendor/katex/katex.min.js");
pub(crate) const KATEX_CSS: &[u8] = include_bytes!("assets/vendor/katex/katex.min.css");
pub(crate) const KATEX_FONTS: &[(&str, &[u8])] = &[
    (
        "KaTeX_AMS-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_AMS-Regular.woff2"),
    ),
    (
        "KaTeX_Caligraphic-Bold.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2"),
    ),
    (
        "KaTeX_Caligraphic-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2"),
    ),
    (
        "KaTeX_Fraktur-Bold.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2"),
    ),
    (
        "KaTeX_Fraktur-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2"),
    ),
    (
        "KaTeX_Main-Bold.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Main-Bold.woff2"),
    ),
    (
        "KaTeX_Main-BoldItalic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2"),
    ),
    (
        "KaTeX_Main-Italic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Main-Italic.woff2"),
    ),
    (
        "KaTeX_Main-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Main-Regular.woff2"),
    ),
    (
        "KaTeX_Math-BoldItalic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2"),
    ),
    (
        "KaTeX_Math-Italic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Math-Italic.woff2"),
    ),
    (
        "KaTeX_SansSerif-Bold.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2"),
    ),
    (
        "KaTeX_SansSerif-Italic.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2"),
    ),
    (
        "KaTeX_SansSerif-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2"),
    ),
    (
        "KaTeX_Script-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Script-Regular.woff2"),
    ),
    (
        "KaTeX_Size1-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Size1-Regular.woff2"),
    ),
    (
        "KaTeX_Size2-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Size2-Regular.woff2"),
    ),
    (
        "KaTeX_Size3-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Size3-Regular.woff2"),
    ),
    (
        "KaTeX_Size4-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Size4-Regular.woff2"),
    ),
    (
        "KaTeX_Typewriter-Regular.woff2",
        include_bytes!("assets/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2"),
    ),
];

/// A bundled asset served over [`LOCAL_ASSET_PROTOCOL`].
pub struct BundledAsset {
    pub status: u16,
    pub content_type: &'static str,
    pub body: std::borrow::Cow<'static, [u8]>,
}

/// Resolve a bundled-asset request URI to its bytes (404 body when unknown).
pub fn bundled_asset_response(uri: &str) -> BundledAsset {
    match bundled_asset_bytes(uri) {
        Some((content_type, body)) => BundledAsset {
            status: 200,
            content_type,
            body: std::borrow::Cow::Borrowed(body),
        },
        None => BundledAsset {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            body: std::borrow::Cow::Borrowed(b""),
        },
    }
}

pub(crate) fn bundled_asset_bytes(uri: &str) -> Option<(&'static str, &'static [u8])> {
    let url = Url::parse(uri).ok()?;
    let path = url.path().trim_start_matches('/');
    match path {
        // The whole reading-mode stylesheet (fonts, Primer primitives, compiled
        // theme tokens, and app layout) is served here as a linked stylesheet
        // rather than inlined into the shell HTML. WebView2 loads the shell via
        // `NavigateToString`, which rejects strings past ~2 MB (UTF-16) with
        // E_INVALIDARG; keeping this ~1.3 MB of CSS out of that string is what
        // stops the shell from tripping the cap as themes/fonts grow. Linked
        // resources carry no such limit. `app_shell_size_stays_under_navigate_
        // to_string_budget` guards the inlined shell against regressing.
        "app.css" => Some(("text/css; charset=utf-8", reading_mode_css().as_bytes())),
        "mermaid.min.js" => Some(("text/javascript; charset=utf-8", MERMAID_JS)),
        "pixi.min.js" => Some(("text/javascript; charset=utf-8", PIXI_JS)),
        "pixi-unsafe-eval.min.js" => Some(("text/javascript; charset=utf-8", PIXI_UNSAFE_EVAL_JS)),
        "d3-force.min.js" => Some(("text/javascript; charset=utf-8", D3_FORCE_JS)),
        "katex/katex.min.js" => Some(("text/javascript; charset=utf-8", KATEX_JS)),
        "katex/katex.min.css" => Some(("text/css; charset=utf-8", KATEX_CSS)),
        _ => {
            let font = path.strip_prefix("katex/fonts/")?;
            KATEX_FONTS
                .iter()
                .find(|(name, _)| *name == font)
                .map(|(_, bytes)| ("font/woff2", *bytes))
        }
    }
}

/// Webview URL for a bundled asset (mirrors the local-image URL rewrite).
pub(crate) fn bundled_asset_url(path: &str) -> String {
    let protocol_url = format!("{LOCAL_ASSET_PROTOCOL}://{LOCAL_IMAGE_HOST}/{path}");
    bundled_asset_webview_url_from_protocol_url(&protocol_url)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) fn bundled_asset_webview_url_from_protocol_url(url: &str) -> String {
    url.replacen(
        &format!("{LOCAL_ASSET_PROTOCOL}://"),
        &format!("http://{LOCAL_ASSET_PROTOCOL}."),
        1,
    )
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub(crate) fn bundled_asset_webview_url_from_protocol_url(url: &str) -> String {
    url.to_string()
}

pub(crate) fn normalize_svg_icon_colors(svg: &str) -> String {
    let mut normalized = String::with_capacity(svg.len());
    let mut index = 0;

    while index < svg.len() {
        if let Some(attribute) = svg_icon_attribute_at(svg, index) {
            if let Some(parsed) = parse_quoted_attribute_value(svg, index + attribute.len()) {
                normalized.push_str(&svg[index..parsed.value_start]);
                let value = &svg[parsed.value_start..parsed.value_end];
                match attribute {
                    SvgIconAttribute::Color { .. } => {
                        normalized.push_str(&normalize_svg_icon_color_value(value));
                    }
                    SvgIconAttribute::Style => {
                        normalized.push_str(&normalize_svg_icon_style_value(value));
                    }
                }
                index = parsed.value_end;
                continue;
            }
        }

        let character = svg[index..]
            .chars()
            .next()
            .expect("index remains inside the svg string");
        normalized.push(character);
        index += character.len_utf8();
    }

    normalized
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SvgIconAttribute {
    Color { len: usize },
    Style,
}

impl SvgIconAttribute {
    fn len(self) -> usize {
        match self {
            Self::Color { len } => len,
            Self::Style => "style".len(),
        }
    }
}

pub(crate) fn svg_icon_attribute_at(svg: &str, index: usize) -> Option<SvgIconAttribute> {
    if !is_svg_attribute_start_boundary(svg, index) {
        return None;
    }

    for attribute in ["fill", "stroke"] {
        let attribute_end = index + attribute.len();
        if svg
            .get(index..attribute_end)
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(attribute))
            && is_svg_attribute_end_boundary(svg, attribute_end)
        {
            return Some(SvgIconAttribute::Color {
                len: attribute.len(),
            });
        }
    }

    let style_end = index + "style".len();
    if svg
        .get(index..style_end)
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case("style"))
        && is_svg_attribute_end_boundary(svg, style_end)
    {
        return Some(SvgIconAttribute::Style);
    }

    None
}

pub(crate) fn is_svg_attribute_start_boundary(svg: &str, index: usize) -> bool {
    if index == 0 {
        return true;
    }

    match svg[..index].chars().next_back() {
        Some(character) => !is_svg_attribute_name_character(character),
        None => true,
    }
}

pub(crate) fn is_svg_attribute_end_boundary(svg: &str, index: usize) -> bool {
    if index >= svg.len() {
        return true;
    }

    match svg[index..].chars().next() {
        Some(character) => !is_svg_attribute_name_character(character),
        None => true,
    }
}

pub(crate) fn is_svg_attribute_name_character(character: char) -> bool {
    matches!(
        character,
        'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | ':'
    )
}

pub(crate) struct SvgAttributeValue {
    value_start: usize,
    value_end: usize,
}

pub(crate) fn parse_quoted_attribute_value(
    svg: &str,
    mut index: usize,
) -> Option<SvgAttributeValue> {
    index = skip_html_whitespace(svg, index);
    if !svg[index..].starts_with('=') {
        return None;
    }

    index += 1;
    index = skip_html_whitespace(svg, index);
    let quote = svg[index..].chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }

    let value_start = index + quote.len_utf8();
    let value_end = svg[value_start..]
        .find(quote)
        .map(|offset| value_start + offset)?;
    Some(SvgAttributeValue {
        value_start,
        value_end,
    })
}

pub(crate) fn normalize_svg_icon_color_value(value: &str) -> String {
    if is_svg_icon_literal_color(value) {
        "currentColor".to_string()
    } else {
        value.to_string()
    }
}

pub(crate) fn normalize_svg_icon_style_value(style: &str) -> String {
    let mut normalized = String::with_capacity(style.len());
    let mut index = 0;

    while index < style.len() {
        if let Some(property) = svg_icon_style_color_property_at(style, index) {
            let after_property = index + property.len();
            if let Some((value_start, value_end)) =
                parse_svg_icon_style_declaration_value(style, after_property)
            {
                normalized.push_str(&style[index..value_start]);
                let value = &style[value_start..value_end];
                normalized.push_str(&normalize_svg_icon_color_value(value));
                index = value_end;
                continue;
            }
        }

        let character = style[index..]
            .chars()
            .next()
            .expect("index remains inside the style string");
        normalized.push(character);
        index += character.len_utf8();
    }

    normalized
}

pub(crate) fn svg_icon_style_color_property_at(style: &str, index: usize) -> Option<&'static str> {
    if !is_svg_style_property_start_boundary(style, index) {
        return None;
    }

    for property in ["fill", "stroke"] {
        let property_end = index + property.len();
        if style
            .get(index..property_end)
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(property))
            && is_svg_style_property_end_boundary(style, property_end)
        {
            return Some(property);
        }
    }

    None
}

pub(crate) fn is_svg_style_property_start_boundary(style: &str, index: usize) -> bool {
    if index == 0 {
        return true;
    }

    match style[..index].chars().next_back() {
        Some(character) => !is_svg_style_property_name_character(character),
        None => true,
    }
}

pub(crate) fn is_svg_style_property_end_boundary(style: &str, index: usize) -> bool {
    if index >= style.len() {
        return true;
    }

    match style[index..].chars().next() {
        Some(character) => !is_svg_style_property_name_character(character),
        None => true,
    }
}

pub(crate) fn is_svg_style_property_name_character(character: char) -> bool {
    matches!(character, 'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_')
}

pub(crate) fn parse_svg_icon_style_declaration_value(
    style: &str,
    mut index: usize,
) -> Option<(usize, usize)> {
    index = skip_html_whitespace(style, index);
    if !style[index..].starts_with(':') {
        return None;
    }

    let value_start = skip_html_whitespace(style, index + 1);
    let value_end = style[value_start..]
        .find(';')
        .map(|offset| value_start + offset)
        .unwrap_or(style.len());

    Some((value_start, value_end))
}

pub(crate) fn is_svg_icon_literal_color(value: &str) -> bool {
    let color = value
        .trim()
        .to_ascii_lowercase()
        .trim_end_matches("!important")
        .trim()
        .to_string();

    if color.is_empty()
        || matches!(
            color.as_str(),
            "none" | "currentcolor" | "inherit" | "initial" | "unset" | "revert" | "transparent"
        )
        || color.starts_with("var(")
    {
        return false;
    }

    if let Some(hex) = color.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8)
            && hex.chars().all(|character| character.is_ascii_hexdigit());
    }

    if ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|function| color.starts_with(function))
    {
        return true;
    }

    color
        .chars()
        .all(|character| character.is_ascii_alphabetic() || character == '-')
}
