use crate::*;

/// The arrow back up to a footnote's reference. The renderer writes this one into the document itself, so it is markup rather than a class.
pub(crate) const FOOTNOTE_BACKREF_ICON_SVG: &str = include_str!("assets/arrow-uturn-left.svg");

// Bundled runtimes (mermaid, KaTeX, graph libs) compiled into the binary and served over a custom protocol, so math/diagrams render offline. Loaded lazily by the page only when a document needs them.
pub const LOCAL_ASSET_PROTOCOL: &str = "leaf-asset";
pub(crate) const MERMAID_JS: &[u8] = include_bytes!("assets/vendor/mermaid.min.js");
// PixiJS (WebGL) + d3-force power the library graph view.
pub(crate) const PIXI_JS: &[u8] = include_bytes!("assets/vendor/pixi.min.js");
// Pixi compiles shaders with `new Function`, which the CSP forbids (no 'unsafe-eval'). This official companion swaps those paths for eval-free polyfills so the graph renders without loosening the CSP.
pub(crate) const PIXI_UNSAFE_EVAL_JS: &[u8] =
    include_bytes!("assets/vendor/pixi-unsafe-eval.min.js");
pub(crate) const D3_FORCE_JS: &[u8] = include_bytes!("assets/vendor/d3-force.min.js");
// Monaco (the VS Code editor) powers the raw-source code view: line wrapping, huge files, and a built-in colored minimap. Vendored as one self-contained bundle — core editor plus the Markdown/HTML/XML/YAML colorizers, no language services or web workers — built by `scripts/bundle-monaco.mjs`. The icon font is inlined, so `monaco.js` + `monaco.css` is the whole of it.
pub(crate) const MONACO_JS: &[u8] = include_bytes!("assets/vendor/monaco/monaco.js");
pub(crate) const MONACO_CSS: &[u8] = include_bytes!("assets/vendor/monaco/monaco.css");
pub(crate) const KATEX_JS: &[u8] = include_bytes!("assets/vendor/katex/katex.min.js");
pub const KATEX_CSS: &[u8] = include_bytes!("assets/vendor/katex/katex.min.css");
// The minimap both published sites run, compiled in so an exported page can carry its own copy of it. One source in the tree for the rail's arithmetic: the desktop's rail, leaftext.com's, empty.guru's and an exported page's are all this file. Respelled for the exported page by `exported_page_minimap_script`, which is what makes it load off a disk.
pub(crate) const SITE_MINIMAP_JS: &str = include_str!("../site/minimap.js");
pub const KATEX_FONTS: &[(&str, &[u8])] = &[
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

/// Webview URL for a staged code-view payload.
///
/// Windows and Android cannot route a custom scheme, so wry intercepts it as `http://<scheme>.<host>/…`; a raw `leaf-source://` URL there fails to load.
pub fn source_payload_url(protocol: &str, id: u64) -> String {
    let protocol_url = format!("{protocol}://{LOCAL_IMAGE_HOST}/payload/{id}");
    #[cfg(any(target_os = "windows", target_os = "android"))]
    return protocol_url.replacen(&format!("{protocol}://"), &format!("http://{protocol}."), 1);
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    return protocol_url;
}

/// A bundled asset served over [`LOCAL_ASSET_PROTOCOL`].
pub struct BundledAsset {
    pub status: u16,
    pub content_type: &'static str,
    // The scripts load in anonymous cross-origin mode so a throw inside one reaches window.onerror with its message and place instead of the browser's masked `Script error.`; this is the response half of that pair. App-owned executable bytes, so the read reveals nothing the page could not already run.
    pub allow_origin: &'static str,
    pub body: std::borrow::Cow<'static, [u8]>,
}

/// Resolve a bundled-asset request URI to its bytes (404 body when unknown).
pub fn bundled_asset_response(uri: &str) -> BundledAsset {
    match bundled_asset_bytes(uri) {
        Some((content_type, body)) => BundledAsset {
            status: 200,
            content_type,
            allow_origin: "*",
            body: std::borrow::Cow::Borrowed(body),
        },
        None => BundledAsset {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            allow_origin: "*",
            body: std::borrow::Cow::Borrowed(b""),
        },
    }
}

pub(crate) fn bundled_asset_bytes(uri: &str) -> Option<(&'static str, &'static [u8])> {
    let url = Url::parse(uri).ok()?;
    let path = url.path().trim_start_matches('/');
    match path {
        // The whole reading-mode stylesheet (font faces, the compiled theme tokens, and app layout) is served here as a linked stylesheet rather than inlined into the shell HTML. WebView2 loads the shell via `NavigateToString`, which rejects strings past ~2 MB (UTF-16) with E_INVALIDARG; keeping this ~1.3 MB of CSS out of that string is what stops the shell from tripping the cap as themes/fonts grow. Linked resources carry no such limit. `app_shell_size_stays_under_navigate_ to_string_budget` guards the inlined shell against regressing.
        "app.css" => Some(("text/css; charset=utf-8", reading_mode_css().as_bytes())),
        // The whole front-end, out of the shell string for the same reason: the script was 88% of it.
        "app.js" => Some((
            "text/javascript; charset=utf-8",
            app_shell_script().as_bytes(),
        )),
        // The same front-end with a stopwatch on every part of it, served only to a copy `just probe-evaluation` launched. Nothing but that copy's page names it, so a reader's launch is the byte-for-byte join above.
        APP_SHELL_EVALUATION_SCRIPT_ASSET => Some((
            "text/javascript; charset=utf-8",
            app_shell_evaluation_script().as_bytes(),
        )),
        "mermaid.min.js" => Some(("text/javascript; charset=utf-8", MERMAID_JS)),
        "pixi.min.js" => Some(("text/javascript; charset=utf-8", PIXI_JS)),
        "pixi-unsafe-eval.min.js" => Some(("text/javascript; charset=utf-8", PIXI_UNSAFE_EVAL_JS)),
        "d3-force.min.js" => Some(("text/javascript; charset=utf-8", D3_FORCE_JS)),
        "monaco/monaco.js" => Some(("text/javascript; charset=utf-8", MONACO_JS)),
        "monaco/monaco.css" => Some(("text/css; charset=utf-8", MONACO_CSS)),
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

/// The two names the desktop page can give the front end: the one every reader is served, and the probe-only one whose every part is timed.
pub const APP_SHELL_SCRIPT_ASSET: &str = "app.js";
pub const APP_SHELL_EVALUATION_SCRIPT_ASSET: &str = "app-evaluation.js";

/// Where the last fragment stops building the page and starts making it usable. Everything from this line on is the boot tail, and the evaluation asset times its statements one at a time: they run after every fragment has been evaluated, so they are the last thing between a launch and a window somebody can use.
const BOOT_TAIL_FIRST_LINE: &str = "window.__leafBooted = true;";

/// The prefix every mark and measure the evaluation asset writes carries, so the probe can tell its own from whatever else the page timed.
const EVALUATION_MEASURE_PREFIX: &str = "leaf-evaluation";

/// The front-end as a copy launched to measure it is served: the same fragments from the same list, in the same order and in the one shared scope, with a measure around each of them and around each statement of the boot tail.
///
/// The regions are statements between the fragments rather than a wrapper around them, because a fragment wrapped in a function stops declaring its names where the next fragment reads them — the shared scope is the thing being measured. The page is handed the ordered region names as well, so the probe reads what should have been timed off the same build that timed it rather than off a second list of its own.
pub fn app_shell_evaluation_script() -> &'static str {
    static SCRIPT: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SCRIPT.get_or_init(|| {
        let regions = evaluation_regions();
        let mut script = String::with_capacity(app_shell_script().len() + 16 * 1024);
        script.push_str(";window.__leafEvaluationRegions = [");
        for (at, (name, _)) in regions.iter().enumerate() {
            if at > 0 {
                script.push(',');
            }
            script.push_str(&js_string(name));
        }
        script.push_str("];\n");
        for (name, body) in &regions {
            let mark = js_string(&format!("{EVALUATION_MEASURE_PREFIX}-start:{name}"));
            script.push_str(&format!(";performance.mark({mark});\n"));
            script.push_str(body);
            let measure = js_string(&format!("{EVALUATION_MEASURE_PREFIX}:{name}"));
            script.push_str(&format!("\n;performance.measure({measure}, {mark});\n"));
        }
        script
    })
}

/// Every region the evaluation asset times, in the order it evaluates them: one per fragment, then one per boot-tail statement in place of the last fragment's tail.
pub(crate) fn evaluation_regions() -> Vec<(String, &'static str)> {
    let mut regions: Vec<(String, &'static str)> = Vec::new();
    for (name, source) in APP_SHELL_SCRIPT_PARTS {
        match source.find(BOOT_TAIL_FIRST_LINE) {
            None => regions.push(((*name).to_string(), source)),
            Some(at) => {
                regions.push(((*name).to_string(), &source[..at]));
                regions.extend(boot_tail_regions(&source[at..]));
            }
        }
    }
    regions
}

/// The boot tail split into the statements it is written as. A line starting hard against the left margin opens a statement; an indented line, a closing brace and a comment all belong to the statement above them, which is what keeps a multi-line `if` whole.
fn boot_tail_regions(tail: &'static str) -> Vec<(String, &'static str)> {
    let mut regions: Vec<(String, &'static str)> = Vec::new();
    let mut start = 0;
    let mut at = 0;
    let cut = |from: usize, to: usize, regions: &mut Vec<(String, &'static str)>| {
        let body = &tail[from..to];
        let opening = body
            .lines()
            .next()
            .unwrap_or_default()
            .trim_end_matches(" {");
        regions.push((format!("boot tail {}: {opening}", regions.len() + 1), body));
    };
    for line in tail.split_inclusive('\n') {
        let opens = !line.starts_with(char::is_whitespace)
            && !line.starts_with('}')
            && !line.starts_with("//");
        if opens && at > start {
            cut(start, at, &mut regions);
            start = at;
        }
        at += line.len();
    }
    if at > start {
        cut(start, at, &mut regions);
    }
    regions
}

/// A JavaScript string literal for a name written into the evaluation asset. The boot-tail names are source lines, so they carry quotes and backslashes of their own.
pub(crate) fn js_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            // Both are line terminators to a JavaScript parser and neither ends a string literal, so a name carrying one would end the statement mid-word.
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            _ => out.push(character),
        }
    }
    out.push('"');
    out
}

/// Webview URL for a bundled asset (mirrors the local-image URL rewrite).
///
/// The version rides the URL because the webview's HTTP cache keeps a response's headers with its bytes for a year (`immutable`): a copy that cached an asset before a header change would keep answering with the old headers until the entry dies — which is how the CORS pair shipped and mermaid's throws stayed masked anyway. A new binary must never be answered out of an old binary's cache entry.
pub(crate) fn bundled_asset_url(path: &str) -> String {
    let protocol_url = format!(
        "{LOCAL_ASSET_PROTOCOL}://{LOCAL_IMAGE_HOST}/{path}?v={}",
        env!("CARGO_PKG_VERSION")
    );
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
