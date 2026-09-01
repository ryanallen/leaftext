//! The one question the page asks of a document before it draws the rail beside it: is there anything here?

/// Whether a Markdown source has anything in it. The empty source is the only one that renders nothing, so it is the only one with no rail beside it.
pub fn markdown_has_visible_content(markdown: &str) -> bool {
    !markdown.is_empty()
}

/// The same question of a rendered body, which has no Markdown source to look at: does it hold a block the rail would draw a bar for — a heading, a paragraph, a quote, a list, a fenced block, or any other element with a visible character in it. It returns at the first one and allocates nothing, because walking a 5 MB body to the end costs 174 ms to answer yes.
pub fn html_has_visible_content(html: &str) -> bool {
    let mut cursor = 0;
    while cursor < html.len() {
        let Some(lt) = html[cursor..].find('<') else {
            return false;
        };
        let start = cursor + lt;
        if html[start..].starts_with("<!--") {
            let Some(offset) = html[start..].find("-->") else {
                return false;
            };
            cursor = start + offset + 3;
            continue;
        }
        let name_len = html[start + 1..]
            .bytes()
            .take_while(u8::is_ascii_alphanumeric)
            .count();
        if name_len == 0 {
            cursor = start + 1;
            continue;
        }
        let name = &html[start + 1..start + 1 + name_len];
        let Some(gt) = html[start..].find('>') else {
            return false;
        };
        let open_end = start + gt + 1;
        if html[start..open_end].ends_with("/>") {
            cursor = open_end;
            continue;
        }
        match name {
            // Each of these draws a bar the moment it opens, whatever it holds.
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "blockquote" | "ul" | "ol" | "pre" => {
                return true
            }
            // A wrapper draws no bar of its own. Walking on is the descent into it.
            "section" | "div" | "article" => cursor = open_end,
            // Anything else draws a bar for its own visible text; its children are reached by walking on, the way a wrapper's are.
            _ => {
                let text_end = html[open_end..]
                    .find('<')
                    .map_or(html.len(), |offset| open_end + offset);
                if html[open_end..text_end]
                    .chars()
                    .any(|character| !character.is_whitespace())
                {
                    return true;
                }
                cursor = text_end;
            }
        }
    }
    false
}
