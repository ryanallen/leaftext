//! Fenced code: which language it is, and how it gets highlighted.

use super::*;

#[derive(Debug, Clone)]
pub(crate) struct CodeBlockCapture {
    pub(crate) language: Option<String>,
    pub(crate) code: String,
}

pub(crate) fn render_code_block(capture: &CodeBlockCapture) -> String {
    let Some(language) = capture.language.as_deref() else {
        return format!("<pre><code>{}</code></pre>", encode_text(&capture.code));
    };

    if language.eq_ignore_ascii_case("mermaid") {
        return render_mermaid_code_block(&capture.code);
    }

    let requested_language = language;
    let language = language_definition(requested_language);
    let display_language = language
        .as_ref()
        .map(|language| language.display_name)
        .unwrap_or(requested_language);
    let language_class = format!("language-{}", safe_css_identifier(display_language));
    let highlighted = language
        .and_then(|language| highlight_code(&capture.code, &language))
        .unwrap_or_else(|| encode_text(&capture.code).to_string());
    format!(
        r#"<pre class="highlight" data-language="{}"><code class="{}">{}</code></pre>"#,
        encode_double_quoted_attribute(display_language),
        encode_double_quoted_attribute(&language_class),
        highlighted
    )
}

pub(crate) fn render_mermaid_code_block(code: &str) -> String {
    format!(
        r#"<pre class="mermaid" data-language="mermaid">{}</pre>"#,
        encode_text(mermaid_source_for_runtime(code))
    )
}

pub(crate) fn mermaid_source_for_runtime(code: &str) -> &str {
    strip_mermaid_yaml_frontmatter(code).unwrap_or(code)
}

pub(crate) fn strip_mermaid_yaml_frontmatter(code: &str) -> Option<&str> {
    let first_line_end = code.find('\n')?;
    let first_line = code[..first_line_end].trim_end_matches('\r');
    if first_line.trim() != "---" {
        return None;
    }

    let mut offset = first_line_end + 1;
    for line in code[offset..].split_inclusive('\n') {
        let line_without_newline = line
            .strip_suffix('\n')
            .unwrap_or(line)
            .trim_end_matches('\r');
        let next_offset = offset + line.len();
        if line_without_newline.trim() == "---" {
            return Some(&code[next_offset..]);
        }
        offset = next_offset;
    }

    None
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

pub(crate) fn highlight_code(code: &str, language: &LanguageDefinition) -> Option<String> {
    let syntax_set = syntax_set();
    let syntax = find_syntax(syntax_set, language)?;
    let mut generator = ClassedHTMLGenerator::new_with_class_style(
        syntax,
        syntax_set,
        ClassStyle::SpacedPrefixed { prefix: "syn-" },
    );

    for line in LinesWithEndings::from(code) {
        generator
            .parse_html_for_line_which_includes_newline(line)
            .ok()?;
    }

    Some(generator.finalize())
}

pub(crate) fn syntax_set() -> &'static SyntaxSet {
    static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAX_SET.get_or_init(two_face::syntax::extra_newlines)
}

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
