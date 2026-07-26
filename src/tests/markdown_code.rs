//! Fenced code blocks: language resolution and syntax highlighting.

use super::*;

#[test]
fn highlighter_boundary_escapes_when_requested_language_has_no_syntax() {
    let language = LanguageDefinition {
        display_name: "Imaginary",
        syntax_names: &["Imaginary Leaf Syntax"],
        syntax_tokens: &["imaginary-leaf-syntax"],
    };

    assert_eq!(
        highlight_code("<b>raw</b>", &language),
        None,
        "missing syntaxes should not produce highlighter HTML"
    );

    let rendered = render_code_block(&CodeBlockCapture {
        language: Some("imaginary-leaf-syntax".to_string()),
        code: "<b>raw</b>".to_string(),
    });

    assert_contains(&rendered, r#"data-language="imaginary-leaf-syntax""#);
    assert_contains(&rendered, "&lt;b&gt;raw&lt;/b&gt;");
    assert!(!rendered.contains("<b>raw</b>"));
}

#[test]
fn renders_syntax_highlighted_fenced_code_blocks() {
    let markdown = r#"```rs title="main.rs" {1,3-5}
pub fn main() {
    let value = 1;
}
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="Rust"><code class="language-rust">"#,
    );
    assert_contains(&rendered.html, "syn-storage");
    assert_contains(&rendered.html, "pub");
    assert_contains(&rendered.html, "fn");
    assert_contains(&rendered.html, "let");
    assert!(!rendered.html.contains("title=&quot;main.rs&quot;"));
}

#[test]
fn renders_diff_additions_and_removals_with_theme_token_classes() {
    let markdown = r#"```diff
+added line
-removed line
@@ -1 +1 @@
 unchanged
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="Diff"><code class="language-diff">"#,
    );
    assert_contains(&rendered.html, "syn-inserted");
    assert_contains(&rendered.html, "syn-deleted");
    assert_contains(&rendered.html, "added line");
    assert_contains(&rendered.html, "removed line");
}

#[test]
fn supports_foundation_fenced_code_language_aliases() {
    let cases = [
        (
            "ts",
            "TypeScript",
            "language-typescript",
            "export const value: number = 1;",
        ),
        (
            "typescript",
            "TypeScript",
            "language-typescript",
            "interface User { name: string }",
        ),
        (
            "tsx",
            "TSX",
            "language-tsx",
            "export const App = () => <main>Hello</main>;",
        ),
        (
            "js",
            "JavaScript",
            "language-javascript",
            "const value = 1;",
        ),
        (
            "javascript",
            "JavaScript",
            "language-javascript",
            "function run() { return true; }",
        ),
        (
            "jsx",
            "JSX",
            "language-jsx",
            "export const App = () => <main>Hello</main>;",
        ),
        (
            "json",
            "JSON",
            "language-json",
            r#"{ "enabled": true, "count": 1 }"#,
        ),
        (
            "jsonc",
            "JSONC",
            "language-jsonc",
            r#"{ "enabled": true, "count": 1 }"#,
        ),
        (
            "html",
            "HTML",
            "language-html",
            "<div class=\"card\">Text</div>",
        ),
        ("css", "CSS", "language-css", ".card { color: red; }"),
        (
            "scss",
            "SCSS",
            "language-scss",
            "$color: red; .card { color: $color; }",
        ),
        ("md", "Markdown", "language-markdown", "# Title"),
        ("markdown", "Markdown", "language-markdown", "## Heading"),
        ("bash", "Bash", "language-bash", "echo \"$HOME\""),
        ("sh", "Bash", "language-bash", "printf '%s\\n' \"$SHELL\""),
        ("shell", "Bash", "language-bash", "set -euo pipefail"),
        ("zsh", "Bash", "language-bash", "autoload -Uz compinit"),
        ("yaml", "YAML", "language-yaml", "enabled: true"),
        ("yml", "YAML", "language-yaml", "items:\n  - one"),
        (
            "toml",
            "TOML",
            "language-toml",
            "[package]\nname = \"leaf\"",
        ),
        ("xml", "XML", "language-xml", "<root enabled=\"true\" />"),
        (
            "rust",
            "Rust",
            "language-rust",
            "pub fn main() { let value = 1; }",
        ),
        ("rs", "Rust", "language-rust", "fn main() {}"),
        (
            "python",
            "Python",
            "language-python",
            "def run():\n    return True",
        ),
        ("py", "Python", "language-python", "print('leaf')"),
        ("sql", "SQL", "language-sql", "select * from documents;"),
        ("diff", "Diff", "language-diff", "+added\n-removed"),
        ("patch", "Diff", "language-diff", "@@ -1 +1 @@\n-old\n+new"),
        ("ini", "INI", "language-ini", "[leaf]\nenabled=true"),
        ("dotenv", "Dotenv", "language-dotenv", "LEAF_MODE=preview"),
        (
            "dockerfile",
            "Dockerfile",
            "language-dockerfile",
            "FROM scratch",
        ),
        (
            "graphql",
            "GraphQL",
            "language-graphql",
            "query Leaf { title }",
        ),
        (
            "gql",
            "GraphQL",
            "language-graphql",
            "mutation Save { save }",
        ),
        ("text", "Text", "language-text", "plain text"),
        ("plain", "Text", "language-text", "plain fallback"),
    ];

    for (identifier, display, class_name, code) in cases {
        let rendered =
            render_markdown_document(&format!("```{identifier}\n{code}\n```"), "README.md");

        assert_contains(
            &rendered.html,
            &format!(
                r#"<pre class="highlight" data-language="{display}"><code class="{class_name}">"#
            ),
        );
        assert_contains(&rendered.html, "syn-");
    }
}

#[test]
fn supported_language_aliases_resolve_to_bundled_syntaxes() {
    for identifier in [
        "ts",
        "typescript",
        "tsx",
        "js",
        "javascript",
        "jsx",
        "json",
        "jsonc",
        "html",
        "css",
        "scss",
        "md",
        "markdown",
        "bash",
        "sh",
        "shell",
        "zsh",
        "yaml",
        "yml",
        "toml",
        "xml",
        "rust",
        "rs",
        "python",
        "py",
        "sql",
        "diff",
        "patch",
        "ini",
        "dotenv",
        "dockerfile",
        "graphql",
        "gql",
        "plain",
    ] {
        let language = language_definition(identifier)
            .unwrap_or_else(|| panic!("expected {identifier} to be supported"));
        assert!(
            find_syntax(syntax_set(), &language).is_some(),
            "expected {identifier} to resolve to a bundled syntax"
        );
    }
}

#[test]
fn falls_back_safely_for_unknown_and_empty_code_blocks() {
    let markdown = r#"```unknownlang
const value = "<raw>";
```

```
plain without language
```

```ts" onmouseover="alert(1)
const safe = true;
```

```
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="unknownlang"><code class="language-unknownlang">const value = "&lt;raw&gt;";"#,
    );
    assert_contains(&rendered.html, "<pre><code>plain without language");
    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="ts&quot;"><code class="language-ts">"#,
    );
    assert_contains(&rendered.html, "<pre><code></code></pre>");
    assert!(!rendered.html.contains("onmouseover"));
    assert!(!rendered.html.contains("<script"));
}

#[test]
fn escapes_malicious_code_fence_language_identifiers() {
    let markdown = r#"```"><img src=x onerror=alert(1)
<script>alert("identifier")</script>
```

```bad/lang<script>
const value = "<raw>";
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="&quot;><img"><code class="language-img">"#,
    );
    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="bad/lang<script>"><code class="language-badlangscript">"#,
    );
    assert_contains(&rendered.html, "&lt;script&gt;alert");
    assert_contains(&rendered.html, "const value = \"&lt;raw&gt;\";");
    assert!(!rendered.html.contains("<img src"));
    assert!(!rendered.html.contains("onerror"));
    assert!(!rendered.html.contains("<script>alert"));
}

#[test]
fn ignores_and_escapes_malicious_code_fence_metadata() {
    let markdown = r#"```ts title="<img src=x onerror=alert(1)>" onclick="alert(2)" {1}
const label = "<button onclick=alert(3)>copy</button>";
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="TypeScript"><code class="language-typescript">"#,
    );
    assert_contains(&rendered.html, "&lt;button");
    assert_contains(&rendered.html, "onclick=alert");
    assert!(!rendered.html.contains("title=&quot;"));
    assert!(!rendered.html.contains("<img"));
    assert!(!rendered.html.contains("onerror"));
    assert!(!rendered.html.contains("alert(2)"));
    assert!(!rendered.html.contains("{1}"));
}

#[test]
fn escapes_code_content_and_preserves_whitespace() {
    let markdown = "```html\n\t<script>alert(1)</script>  \n<div onerror=\"bad\">x</div>\n```";

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(&rendered.html, "\t");
    assert_contains(&rendered.html, "&lt;");
    assert_contains(&rendered.html, "script");
    assert_contains(&rendered.html, "alert");
    assert!(
        rendered.html.contains("  \n") || rendered.html.contains("  \r\n"),
        "expected trailing spaces before the line break to be preserved:\n{}",
        rendered.html
    );
    assert_contains(&rendered.html, "onerror");
    assert!(!rendered.html.contains("<script>"));
    assert!(!rendered.html.contains("<div onerror"));
}

#[test]
fn handles_large_and_multiple_highlighted_code_blocks() {
    let large_code = (0..300)
        .map(|index| format!("const value{index} = {index};"))
        .collect::<Vec<_>>()
        .join("\n");
    let markdown = format!(
        "```ts\n{large_code}\n```\n\n```js\nconsole.log(\"done\")\n```\n\n```nonsense\nraw\n```"
    );

    let rendered = render_markdown_document(&markdown, "README.md");

    assert_eq!(
        rendered.html.matches(r#"<pre class="highlight""#).count(),
        3
    );
    assert_contains(&rendered.html, "value299");
    assert_contains(&rendered.html, r#"data-language="TypeScript""#);
    assert_contains(&rendered.html, r#"data-language="JavaScript""#);
    assert_contains(&rendered.html, r#"data-language="nonsense""#);
}
