# Markdown Rendering

> leaftext renders CommonMark, GFM, and the GitHub-style extras people actually use: code fences, Mermaid, math, alerts, footnotes, emoji, and local images.

leaftext parses Markdown in Rust with `pulldown-cmark`, applies a GitHub-like rendering pipeline, sanitizes the HTML, and then hands the finished result to the WebView. Every feature below is shown with a live example, rendered by the same engine that draws your documents.

## Summary

| Category | Supported |
| --- | --- |
| Core Markdown | Headings, paragraphs, lists, links, images, blockquotes, rules, inline code |
| GFM | Tables, task lists, strikethrough, autolinks |
| Extras | Syntax highlighting, Mermaid, math, alerts, footnotes, emoji, block permalinks |
| Local content | Relative images |
| Safety | Sanitized HTML allowlist |

## Pipeline

```mermaid
flowchart LR
    A[Markdown file] --> B[pulldown-cmark]
    B --> C[GitHub-style extras]
    C --> D[ammonia sanitizer]
    D --> E[Rendered document in leaftext]
```

## Headings

All six ATX heading levels render:

# H1 heading
## H2 heading
### H3 heading
#### H4 heading
##### H5 heading
###### H6 heading

Every heading gets a slug `id`. Every other content block — paragraphs, list items, blockquotes, code blocks, tables, and more — gets a stable auto-assigned `id` too. Hover any block, or the gutter spot beside it, to reveal a permalink button in the left margin; clicking it jumps to that exact block. On touch devices, which have no hover, the button stays faintly visible in the margin beside every block and brightens when tapped. Blocks with an explicit author-supplied `id` work the same way — see [Inline HTML](#inline-html).

## Text formatting

- *Italic* and _italic_
- **Bold** and __bold__
- ***Bold italic***
- ~~Strikethrough~~ (GFM)
- `inline code`
- Inline footnote reference[^demo]

A trailing backslash forces a hard line break,\
so this sentence continues on the next line.

## Lists

Unordered, with nesting:

- Leaves
  - Simple
  - Compound
- Stems
- Roots

Ordered lists nest into a classic outline (I, A, 1, a, i):

1. Trees
   1. Broadleaf
      1. Deciduous
         1. Maple
            1. Sugar maple
            2. Red maple
            3. Silver maple
         2. Oak
      2. Evergreen
         1. Holly
   2. Needleleaf
      1. Pine
2. Shrubs
3. Ground cover

## Blockquotes and alerts

A blockquote, nested:

> "Read deeply, not widely."
>
> > A leaf within a leaf.

GitHub-style alerts render with theme-aware colors (all five):

> [!NOTE]
> Leaf Text renders Markdown — it never edits it.

> [!TIP]
> Search every leaf in your library with a keystroke.

> [!IMPORTANT]
> Pages render entirely on your machine. No network.

> [!WARNING]
> A reader, not an editor.

> [!CAUTION]
> A stray `---` mid-page is a horizontal rule, not frontmatter.

Standard blockquotes also use a hanging indent for each authored line, so when a long quoted line wraps in the reader the continuation stays inset and you can distinguish a soft wrap from a Markdown hard line break.

## Code

Language-tagged fenced code blocks get syntax coloring, a language badge, and a Copy button. Hover a block to reveal the button.

```rust
/// Extract the leading frontmatter block, if any.
pub fn extract_frontmatter(text: &str) -> Option<FrontmatterBlock> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let mut body = String::new();
    for line in lines {
        if line.trim_end() == "---" {
            return Some(FrontmatterBlock { body });
        }
        body.push_str(line);
        body.push('\n');
    }
    None
}
```

A plain fence renders as monospace with no colors:

```
no language, no highlighting
```

Supported language tags include `ts`, `tsx`, `js`, `jsx`, `json`, `html`, `css`, `scss`, `md`, `bash`, `zsh`, `yaml`, `toml`, `xml`, `ini`, `rust`, `python`, `sql`, `diff`, `dotenv`, `dockerfile`, `graphql`, and plain text.

## Tables

GFM tables with a header row and a body:

| Feature       | Syntax         | Supported |
| ------------- | -------------- | --------- |
| Tables        | `\| a \| b \|` | ✅        |
| Strikethrough | `~~text~~`     | ✅        |
| Task lists    | `- [ ] item`   | ✅        |
| Autolinks     | bare URLs      | ✅        |

## Task lists

- [x] Render a page
- [x] Search the library
- [ ] Edit anything (out of scope — Leaf Text is a reader)

## Links and autolinks

- Inline link: [the Leaf Text repo](https://github.com/ryanallen/leaftext)
- Reference link: [CommonMark][cm]
- Relative link to a sibling page: [Navigation](navigation.md)
- In-page link back to the [top](#markdown-rendering)
- Bare URL autolink: https://github.com/ryanallen/leaftext
- www autolink: www.example.com
- Email autolink: hello@example.com

[cm]: https://commonmark.org

## Images

Relative image paths work when they stay inside the opened file's allowed directory scope; the title shows on hover:

![Leaf Text](../../imgs/leaftext.png "Leaf Text — Markdown, made to read")

Allowed image types include SVG, PNG, JPEG, GIF, APNG, AVIF, BMP, ICO, and WebP.

## Math

Inline math uses `$…$`: the mass–energy equivalence is $E = mc^2$.

Display math uses `$$…$$`:

$$
\int_{a}^{b} f(x)\,dx = F(b) - F(a)
$$

## Mermaid diagrams

`mermaid` fences are rendered with the bundled Mermaid runtime, fully offline. If Mermaid fails, leaftext leaves the source visible instead of a blank block.

```mermaid
flowchart TD
    A[Open file] --> B{Frontmatter?}
    B -- yes --> C[Parse fields]
    B -- no --> D[Index body only]
    C --> E[Filter library by field]
    D --> E
```

```mermaid
sequenceDiagram
    participant UI
    participant Reader
    UI->>Reader: getFileTree { filter }
    Reader-->>UI: leafSetLibraryState(tree)
```

## Emoji

leaftext renders GitHub shortcodes:

- `:rocket:` → :rocket:
- `:tada:` → :tada:
- `:warning:` → :warning:
- `:white_check_mark:` → :white_check_mark:
- `:shipit:` → :shipit:

## GitHub references

Inside a Git repo, issue, PR, and commit references link to the repo; @mentions are highlighted:

- Issue or PR: #1, GH-2
- Cross-repo issue: ryanallen/leaftext#3
- Commit: e4d3ec8
- Mention: @ryanallen
- Team mention: @ryanallen/maintainers

## Footnotes

Footnotes collect at the foot of the page, each with a back-link.[^one] Reference one twice[^one] or add more.[^two]

[^demo]: Referenced from the *Text formatting* section.
[^one]: Click the back-arrow to jump back.
[^two]: With `inline code` and a [link](https://commonmark.org).

## Frontmatter

A leading `--- … ---` block becomes a metadata table at the top of the page:

```yaml
---
title: Launch Notes                # key: value scalar
status: draft                      # strings, booleans, numbers, dates → text
audience: [readers, testers]       # inline array → one row per item
tags:                              # block list → one row per item
  - markdown
  - demo
created: 2026-06-14
pinned: true
---
```

…renders as this table (list values expand to one row each):

<div class="frontmatter"><table><tbody><tr><th>title</th><td>Launch Notes</td></tr><tr><th>status</th><td>draft</td></tr><tr><th>audience</th><td>readers</td></tr><tr><th>audience</th><td>testers</td></tr><tr><th>tags</th><td>markdown</td></tr><tr><th>tags</th><td>demo</td></tr><tr><th>created</th><td>2026-06-14</td></tr><tr><th>pinned</th><td>true</td></tr></tbody></table></div>

- Only the **leading** block counts; a later `---` is a horizontal rule.
- Malformed frontmatter still renders — just without the table.

## Collapsible sections

`<details>` / `<summary>` fold content away. Add `open` to start expanded.

<details open>
<summary>Open by default — click to collapse</summary>

Folded content holds full Markdown: **formatting**, <kbd>Ctrl</kbd>, and a list.

- A leaf
- A page

</details>

<details>
<summary>Closed by default — click to expand</summary>

Tucked away until you open it.

</details>

## Inline HTML

leaftext sanitizes raw HTML with `ammonia`: a curated set of **safe** tags is allowed; the rest is stripped, keeping the inner text.

Beyond plain Markdown: <ins>inserted</ins>, <s>struck</s>, and <mark>highlighted</mark> text. Water is H<sub>2</sub>O and 2<sup>10</sup> = 1024. Press <kbd>Ctrl</kbd> + <kbd>F</kbd> to search. An <abbr title="HyperText Markup Language">HTML</abbr> abbreviation shows its title on hover.

Definition list:

<dl>
<dt>Leaf</dt>
<dd>A page, rendered for reading.</dd>
<dt>Frontmatter</dt>
<dd>Metadata at the top of a page.</dd>
</dl>

`align` on `<div>`, `<p>`, and headings (`<h1>`–`<h6>`) controls horizontal alignment:

<div align="center">Centered block</div>
<p align="right">Right-aligned paragraph</p>
<h2 align="center">Centered heading</h2>

Accepted values: `left`, `center`, `right`, `justify`. Note: `align` is stripped from `<blockquote>` — it is not in the allowlist for that tag.

An `id` on any block element creates a named anchor with a stable, author-controlled address for deep-linking:

<h1 id="foreword" align="center">Foreword</h1>

Link to it from anywhere on the same page: `[Foreword](#foreword)`. Hovering the block (or the gutter slot next to it) reveals a permalink button in the left margin — the same affordance every content block gets automatically, with or without an explicit `id`.

Every block gets a citable address. Body blocks are numbered *chapter.verse* with a dot, like `1.42`: each top-level heading opens a chapter, and every body block after it — paragraphs, quotes, content list items, tables — is the next running verse in that chapter (`1.1`, `1.2`, `1.3` …), the verse count running straight through sub-headings and resetting only at the next chapter. Headings are numbered too, as `h<chapter>.<n>` — the leading `h` tells a heading apart from a body block — where `n` runs `1`, `2`, `3` … through the headings in that chapter (so the chapter heading is `h1.1`) and resets at the next chapter. A heading keeps its text slug so `#slug` links and the table of contents still resolve, with a hidden alias carrying the number. A list that is purely navigation (the table of contents) is skipped. Clicking a gutter permalink jumps to the block **and** copies its `#locus` to the clipboard, so you can paste the citation out — the way to read it on touch, where there is no hover tooltip. A block with an explicit author `id` keeps that id, with a hidden alias carrying the locus so `#<locus>` resolves too.

`<br>` forces a line break inside a paragraph without starting a new block:

Line one.<br>Same paragraph, next line.

Markdown italic can wrap an HTML heading — useful for centering and italicising a title together:

*<h1 align="center">Words of My Perfect Teacher</h1>*

Stripped for safety: `<script>`, inline event handlers such as `onclick=`, `javascript:` URLs, and disallowed elements such as `<iframe>` and `<form>`.

## Horizontal rules

Three or more `-`, `*`, or `_` on their own line:

---

***

___

## Simplified Chinese

leaftext offers an English and a Simplified Chinese interface, and renders CJK content without altering it:

> 阅读，而非编辑。Leaf Text 只显示渲染后的 Markdown 文档。

| 功能 | 说明 |
| :-- | :-- |
| 全文搜索 | 支持中文前缀匹配 |
| 前置元数据 | 可按字段筛选文库 |

## Next

- [Navigation](navigation.md)
- [Themes](themes.md)
- [Architecture](../development/architecture.md)
