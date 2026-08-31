//! Fenced code: which language it is, and how it gets highlighted.

use super::*;

#[derive(Debug, Clone)]
pub(crate) struct CodeBlockCapture {
    pub(crate) language: Option<String>,
    pub(crate) code: String,
}

pub(crate) fn render_code_block(
    capture: &CodeBlockCapture,
    source_path: &Path,
    host: &dyn LeafHost,
) -> String {
    let Some(language) = capture.language.as_deref() else {
        return format!("<pre><code>{}</code></pre>", encode_text(&capture.code));
    };

    if language.eq_ignore_ascii_case("mermaid") {
        return render_mermaid_code_block(&capture.code, source_path, host);
    }

    render_source_code_block(
        &capture.code,
        language,
        language_definition(language)
            .as_ref()
            .map(|definition| definition.display_name)
            .unwrap_or(language),
    )
}

pub(crate) fn render_source_code_block(
    code: &str,
    language: &str,
    display_language: &str,
) -> String {
    #[cfg(not(feature = "highlight"))]
    let _ = language;
    #[cfg(feature = "highlight")]
    let language = language_definition(language);
    let language_class = format!("language-{}", safe_css_identifier(display_language));
    #[cfg(feature = "highlight")]
    let highlighted = language
        .and_then(|language| highlight_code(code, &language))
        .unwrap_or_else(|| encode_text(code).to_string());
    #[cfg(not(feature = "highlight"))]
    let highlighted = encode_text(code).to_string();
    format!(
        r#"<pre class="highlight" data-language="{}"><code class="{}">{}</code></pre>"#,
        encode_double_quoted_attribute(display_language),
        encode_double_quoted_attribute(&language_class),
        highlighted
    )
}

// The block goes to mermaid as it was written, front matter and all: mermaid 11 reads `title:`, `config:`, `look:` and `layout:` itself. Cut that section out here and the page draws it one way, the flowchart sheet another. The one exception is a box's `img:` path, which is resolved against the document the way a Markdown image is — the page has no idea where the document sits, so a bare path would reach the web view meaning nothing.
pub(crate) fn render_mermaid_code_block(
    code: &str,
    source_path: &Path,
    host: &dyn LeafHost,
) -> String {
    format!(
        r#"<pre class="mermaid" data-language="mermaid">{}</pre>"#,
        encode_text(&resolve_mermaid_image_destinations(code, source_path, host))
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LanguageDefinition {
    pub(crate) display_name: &'static str,
    pub(crate) syntax_names: &'static [&'static str],
    pub(crate) syntax_tokens: &'static [&'static str],
}

pub(crate) fn language_definition(language: &str) -> Option<LanguageDefinition> {
    let normalized = language.trim().to_ascii_lowercase();
    let definition = match normalized.as_str() {
        "ts" | "typescript" => LanguageDefinition {
            display_name: "TypeScript",
            syntax_names: &["TypeScript"],
            syntax_tokens: &["ts", "typescript"],
        },
        "tsx" => LanguageDefinition {
            display_name: "TSX",
            syntax_names: &["TSX", "TypeScriptReact"],
            syntax_tokens: &["tsx"],
        },
        "js" | "javascript" => LanguageDefinition {
            display_name: "JavaScript",
            syntax_names: &["JavaScript"],
            syntax_tokens: &["js", "javascript"],
        },
        "jsx" => LanguageDefinition {
            display_name: "JSX",
            syntax_names: &["JSX", "JavaScriptReact"],
            syntax_tokens: &["jsx"],
        },
        "json" => LanguageDefinition {
            display_name: "JSON",
            syntax_names: &["JSON"],
            syntax_tokens: &["json"],
        },
        "jsonc" => LanguageDefinition {
            display_name: "JSONC",
            syntax_names: &["JSONC", "JSON with Comments", "JSON"],
            syntax_tokens: &["jsonc", "json"],
        },
        "html" => LanguageDefinition {
            display_name: "HTML",
            syntax_names: &["HTML"],
            syntax_tokens: &["html"],
        },
        "css" => LanguageDefinition {
            display_name: "CSS",
            syntax_names: &["CSS"],
            syntax_tokens: &["css"],
        },
        "scss" => LanguageDefinition {
            display_name: "SCSS",
            syntax_names: &["SCSS", "CSS"],
            syntax_tokens: &["scss", "css"],
        },
        "md" | "markdown" => LanguageDefinition {
            display_name: "Markdown",
            syntax_names: &["Markdown"],
            syntax_tokens: &["md", "markdown"],
        },
        "bash" | "sh" | "shell" | "zsh" => LanguageDefinition {
            display_name: "Bash",
            syntax_names: &[
                "Bourne Again Shell (bash)",
                "Shell-Unix-Generic",
                "ShellScript",
                "Bash",
            ],
            syntax_tokens: &["bash", "sh", "shell", "zsh"],
        },
        "yaml" | "yml" => LanguageDefinition {
            display_name: "YAML",
            syntax_names: &["YAML"],
            syntax_tokens: &["yaml", "yml"],
        },
        "toml" => LanguageDefinition {
            display_name: "TOML",
            syntax_names: &["TOML"],
            syntax_tokens: &["toml"],
        },
        "xml" => LanguageDefinition {
            display_name: "XML",
            syntax_names: &["XML"],
            syntax_tokens: &["xml"],
        },
        "rust" | "rs" => LanguageDefinition {
            display_name: "Rust",
            syntax_names: &["Rust"],
            syntax_tokens: &["rs", "rust"],
        },
        "python" | "py" => LanguageDefinition {
            display_name: "Python",
            syntax_names: &["Python"],
            syntax_tokens: &["python", "py"],
        },
        "sql" => LanguageDefinition {
            display_name: "SQL",
            syntax_names: &["SQL"],
            syntax_tokens: &["sql"],
        },
        "diff" | "patch" => LanguageDefinition {
            display_name: "Diff",
            syntax_names: &["Diff"],
            syntax_tokens: &["diff", "patch"],
        },
        "ini" => LanguageDefinition {
            display_name: "INI",
            syntax_names: &["INI"],
            syntax_tokens: &["ini"],
        },
        "dotenv" => LanguageDefinition {
            display_name: "Dotenv",
            syntax_names: &["DotENV", "dotenv"],
            syntax_tokens: &["dotenv", "env"],
        },
        "dockerfile" => LanguageDefinition {
            display_name: "Dockerfile",
            syntax_names: &["Dockerfile"],
            syntax_tokens: &["dockerfile"],
        },
        "graphql" | "gql" => LanguageDefinition {
            display_name: "GraphQL",
            syntax_names: &["GraphQL"],
            syntax_tokens: &["graphql", "gql"],
        },
        "text" | "txt" | "plain" | "plaintext" => LanguageDefinition {
            display_name: "Text",
            syntax_names: &["Plain Text"],
            syntax_tokens: &["txt", "text"],
        },
        _ => return None,
    };

    Some(definition)
}

/// Every `.syn-` rule in `assets/reading/document-code.css`, as the class set one element must carry to match it. The class names are this table's union, and a token keeps exactly the classes of the rules it satisfies — `the_syntax_rules_match_the_stylesheet` fails when the two drift, because a missing rule goes uncolored rather than loud.
#[cfg(feature = "highlight")]
pub(crate) const SYNTAX_STYLE_RULES: &[&[&str]] = &[
    &["attribute"],
    &["boolean"],
    &["changed"],
    &["character"],
    &["class"],
    &["comment"],
    &["constant"],
    &["control"],
    &["deleted"],
    &["entity"],
    &["function"],
    &["heading"],
    &["illegal"],
    &["inserted"],
    &["invalid"],
    &["keyword"],
    &["language"],
    &["method"],
    &["numeric"],
    &["operator"],
    &["parameter"],
    &["property"],
    &["punctuation"],
    &["storage"],
    &["string"],
    &["support"],
    &["tag"],
    &["type"],
    &["variable"],
];

/// The class names, sorted and deduplicated — a class's index here is its bit in the masks below, so the emitted class order is stable.
#[cfg(feature = "highlight")]
pub(crate) fn styled_syntax_classes() -> &'static [&'static str] {
    static CLASSES: OnceLock<Vec<&'static str>> = OnceLock::new();
    CLASSES.get_or_init(|| {
        let mut names: Vec<&'static str> = SYNTAX_STYLE_RULES
            .iter()
            .flat_map(|r| r.iter().copied())
            .collect();
        names.sort_unstable();
        names.dedup();
        assert!(
            names.len() <= 64,
            "the class set is a u64 of bits; {} classes no longer fit",
            names.len()
        );
        names
    })
}

/// One bit per class of each rule, so "does this token satisfy the rule" is `rule & !token == 0`.
#[cfg(feature = "highlight")]
fn syntax_rule_masks() -> &'static [u64] {
    static MASKS: OnceLock<Vec<u64>> = OnceLock::new();
    MASKS.get_or_init(|| {
        SYNTAX_STYLE_RULES
            .iter()
            .map(|rule| {
                rule.iter()
                    .fold(0u64, |mask, class| mask | class_bit(class))
            })
            .collect()
    })
}

#[cfg(feature = "highlight")]
fn class_bit(class: &str) -> u64 {
    styled_syntax_classes()
        .iter()
        .position(|name| *name == class)
        .map(|index| 1u64 << index)
        .unwrap_or(0)
}

/// The class list for everything `carried`, as the union of the rules it satisfies. A class in no satisfied rule cannot affect the cascade, so dropping it paints the same — and dropping all of them means no element is needed.
#[cfg(feature = "highlight")]
pub(crate) fn styled_class_list(carried: u64) -> String {
    let styled = syntax_rule_masks()
        .iter()
        .filter(|rule| *rule & !carried == 0)
        .fold(0u64, |mask, rule| mask | rule);

    let mut list = String::new();
    if styled == 0 {
        return list;
    }
    for (index, class) in styled_syntax_classes().iter().enumerate() {
        if styled & (1u64 << index) == 0 {
            continue;
        }
        if !list.is_empty() {
            list.push(' ');
        }
        list.push_str("syn-");
        list.push_str(class);
    }
    list
}

/// Highlight `code` as one `<span class="syn-…">` per run of identically-styled text. Syntect's `ClassedHTMLGenerator` instead nests a span per scope level naming every scope atom, which on a 4 MB glossary was 336k spans carrying 16 MB of class text — mostly classes no rule could match, since Markdown puts a `meta.paragraph` scope over the whole document and `syn-meta` styles nothing on its own. Keeping only the satisfied rules' classes leaves plain prose with no span at all.
///
/// Spans close at every newline, and the newline sits outside them, because the code view splits this markup per source line.
#[cfg(feature = "highlight")]
pub(crate) fn highlight_code(code: &str, language: &LanguageDefinition) -> Option<String> {
    let syntax_set = syntax_set();
    let syntax = find_syntax(syntax_set, language)?;
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut classes = ScopeClasses::default();
    let mut html = String::with_capacity(code.len() * 2);
    let mut open = String::new();
    let mut wanted = String::new();

    for line in LinesWithEndings::from(code) {
        let ops = state.parse_line(line, syntax_set).ok()?;
        // The parser needs the line break; the markup does not.
        let body = line
            .strip_suffix('\n')
            .map(|body| body.strip_suffix('\r').unwrap_or(body))
            .unwrap_or(line)
            .len();
        let mut at = 0usize;
        for (offset, op) in &ops {
            let until = (*offset).min(body);
            if until > at {
                push_run(&mut html, &mut open, &wanted, &line[at..until]);
                at = until;
            }
            stack.apply(op).ok()?;
            classes.write_stack(&mut wanted, &stack);
        }
        if body > at {
            push_run(&mut html, &mut open, &wanted, &line[at..body]);
        }
        if !open.is_empty() {
            html.push_str("</span>");
            open.clear();
        }
        html.push_str(&line[body..]);
    }

    Some(html)
}

/// Append `text` under the class list `wanted`, reusing the span already open when the list has not changed — that reuse is what merges adjacent tokens into one element.
#[cfg(feature = "highlight")]
pub(crate) fn push_run(html: &mut String, open: &mut String, wanted: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    if wanted != open.as_str() {
        if !open.is_empty() {
            html.push_str("</span>");
        }
        if !wanted.is_empty() {
            html.push_str(r#"<span class=""#);
            html.push_str(wanted);
            html.push_str(r#"">"#);
        }
        open.clear();
        open.push_str(wanted);
    }
    html.push_str(&encode_text(text));
}

/// The classes a token carries, cached at both steps a document repeats: one scope's bits, and one whole stack's class list.
#[cfg(feature = "highlight")]
#[derive(Default)]
struct ScopeClasses {
    bits: HashMap<Scope, u64>,
    lists: HashMap<u64, String>,
}

#[cfg(feature = "highlight")]
impl ScopeClasses {
    fn scope_bits(&mut self, scope: Scope) -> u64 {
        if let Some(bits) = self.bits.get(&scope) {
            return *bits;
        }
        let bits = scope
            .build_string()
            .split('.')
            .fold(0u64, |bits, atom| bits | class_bit(atom));
        self.bits.insert(scope, bits);
        bits
    }

    /// The stack's class list, cached: a document reuses the same few stacks for every one of its tokens.
    fn write_stack(&mut self, out: &mut String, stack: &ScopeStack) {
        let carried = stack
            .scopes
            .iter()
            .fold(0u64, |bits, scope| bits | self.scope_bits(*scope));
        out.clear();
        let list = self
            .lists
            .entry(carried)
            .or_insert_with(|| styled_class_list(carried));
        out.push_str(list);
    }
}

#[cfg(feature = "highlight")]
pub(crate) fn syntax_set() -> &'static SyntaxSet {
    static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAX_SET.get_or_init(two_face::syntax::extra_newlines)
}

#[cfg(feature = "highlight")]
pub(crate) fn find_syntax<'a>(
    syntax_set: &'a SyntaxSet,
    language: &LanguageDefinition,
) -> Option<&'a SyntaxReference> {
    language
        .syntax_names
        .iter()
        .find_map(|name| syntax_set.find_syntax_by_name(name))
        .or_else(|| {
            language
                .syntax_tokens
                .iter()
                .find_map(|token| syntax_set.find_syntax_by_token(token))
        })
}

pub(crate) fn safe_css_identifier(value: &str) -> String {
    value
        .chars()
        .filter_map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' {
                Some(char.to_ascii_lowercase())
            } else {
                None
            }
        })
        .collect::<String>()
}
