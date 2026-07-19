# Architecture

> leaftext is a Rust desktop app using tao for windowing and wry for WebView. The Markdown pipeline, IPC bridge, and background indexer are all covered here.

leaftext is a single Rust binary that embeds a WebView (via `wry`) inside a native window (via `tao`). The Markdown rendering pipeline runs on the Rust side; the result is injected into the WebView as HTML. All user interaction — opening files, navigating history, adjusting settings — flows through a typed IPC bridge between JavaScript running in the WebView and the Rust host.

## Core crates

| Crate                   | Role                                                 |
| ----------------------- | ---------------------------------------------------- |
| `tao`                   | Native windowing and event loop                      |
| `wry`                   | WebView embedding (WKWebView / WebView2 / WebKitGTK) |
| `pulldown-cmark`        | CommonMark + GFM Markdown parser                     |
| `syntect` + `two-face`  | Syntax highlighting for code blocks                 |
| `ammonia`               | HTML sanitization (allowlist-based)                  |
| `rusqlite` (bundled)    | SQLite for the library indexer                       |
| `rfd`                   | Native file dialogs                                  |
| `serde` / `serde_json`  | IPC message serialization                            |
| `notify-debouncer-mini` | Filesystem watcher for live reload                   |
| `blake3`                | File content hashing in the indexer                  |
| `roxmltree`             | Read-only XML DOM parsing for TEI documents          |
| `windows-sys` (Windows) | Named mutex + pipe for the single-instance guard     |

## Source files

leaftext's Rust source is split by concern:

- **`src/main.rs`** — Entry point. Owns the `tao` event loop, the `Workspace` and `Tab` state, the IPC handler dispatch, the `FileWatch` live-reload watcher, and navigation history. Every `UserEvent` variant that drives the UI (open, close tab, switch tab, go back/forward, settings changes, indexer results) is handled here. It also tunes WebView2 with a trimmed browser-argument set (site isolation and background networking off, GPU and the renderer kept hot) to reduce the process/background footprint of a single-window offline reader.
- **`src/lib.rs`** — Core document rendering and app-state helpers. Contains `render_markdown_document()` (which orchestrates the Markdown pipeline in `markdown.rs`), document loading, glossary auto-linking, recent-files and settings persistence, the theme/locale bootstrap scripts, and `app_shell_html()`, which assembles the WebView page by loading the shell markup and script from `src/assets/` (see below) and substituting runtime tokens.
- **`src/scripts.rs`** — Generators for the small JS snippets the host injects to drive the WebView: initial/document/workspace state, navigation, scroll anchoring (`ScrollAnchor`), the glossary sheet, and error state. Each returns a `String` of `window.leaf*(...)` calls that `main.rs` hands to `webview.evaluate_script()`.
- **`src/pager.rs`** — The Previous/Next pager: walks the document's folder tree in reading order (`document_pager_html()`, `PagerEntry`, `pager_label()`) and builds the pager HTML plus the async `pager_loaded_script()` hand-off.
- **`src/tei.rs`** — The TEI XML renderer: converts an 84000-style TEI document into the same HTML the Markdown pipeline produces (`render_tei_body()`, `tei_render_div()` / `tei_render_node()`, `TeiCtx`, `tei_slugify()`). Stamps each editable block with inline `data-src-*` source byte ranges (from `roxmltree`'s `Node::range()`) and exposes `tei_block_source_map()`, so [inline editing](../01-features/07-editing.md#inline-editing-the-reading-view) works for XML too. `pub(crate)` and re-exported at the crate root.
- **`src/minimap.rs`** — The document minimap model: `build_minimap_model()` / `build_minimap_model_from_html()` and the `DocumentMinimap` / `MinimapSpan` types that classify each line run (heading, paragraph, list, blockquote, code fence) for the scrollable overview. `pub(crate)` internals with the public model types re-exported at the crate root.
- **`src/editing.rs`** — The [editing](../01-features/07-editing.md) model: `EditableDocument` (the per-tab source buffer with dirty tracking, a save version counter, `replace_range()` splices for inline edits, `toggle_task()` for checkbox flips, and the bounded [undo](../01-features/07-editing.md#undo) stack), `DocumentFormat` (Markdown vs XML by extension, which picks the code view's highlight language and the re-render path), `render_source_view_html()` (the code view's colour layer, reusing the reader's own highlighter), `block_source_map()` — a `pulldown-cmark` `into_offset_iter()` pass mapping each top-level Markdown block to its exact source byte range — and `task_marker_offsets()` for the interactive checkboxes. These source maps are what [inline editing](../01-features/07-editing.md#inline-editing-the-reading-view) anchors its splices to. Public types re-exported at the crate root.
- **`src/assets.rs`** — Bundled-asset serving and icon processing: the `include_bytes!` Mermaid/KaTeX runtimes and the PixiJS + d3-force bundles that power the [Graph view](../01-features/03-library.md#graph), `bundled_asset_response()` for the `leaf-asset://` scheme, the toolbar/brand SVG constants, and `normalize_svg_icon_colors()` (rewrites literal icon colors to `currentColor`). Not to be confused with the `src/assets/` directory it embeds. `pub(crate)` (plus the public `bundled_asset_response` / `BundledAsset` / `LOCAL_ASSET_PROTOCOL`), re-exported at the crate root.
- **`src/markdown.rs`** — The Markdown rendering pipeline: `pulldown-cmark` parsing, GitHub extras (heading IDs, autolinks, issue/PR/commit references, emoji, footnotes), `syntect` code highlighting, image URL resolution, the `ammonia` HTML sanitizer, document-title detection, and the `local_image_protocol_response()` handler for the `leaf-image://` custom scheme. Its items are `pub(crate)` and re-exported at the crate root.
- **`src/theme.rs`** — The theme system. The semantic token contract (`LEAF_SEMANTIC_TOKEN_CONTRACT`), the Primer and Dracula token tables, the `ThemeSource` / `ThemeSourceKind` types, and the CSS compiler: `theme_sources()`, `compiled_theme_css()`, `theme_source_token_value()`, `assert_theme_sources_cover_contract()`, and `reading_mode_css()`. Its items are `pub(crate)` and re-exported at the crate root. See [theming](04-theming.md).
- **`src/indexer.rs`** — Background SQLite-based library indexer. Implements a breadth-first filesystem walk with a parse/hash worker pool (`PARSE_WORKERS = 4`), incremental fast-path checks on `mtime + size`, missing-file detection, and a separate read-only connection so tree queries answer promptly during a full crawl. It also answers the library's full-text search: files are split into chunks indexed in a SQLite FTS5 table, queried with BM25 ranking and highlighted snippets, optionally restricted to a set of document paths (the view's search scope), and frontmatter fields are parsed into a normalized table. `build_graph()` assembles the [Graph view](../01-features/03-library.md#graph)'s link map — one node per indexed document, one undirected edge per resolved doc-to-doc link — sliced by a `GraphRequest` (a focused neighborhood around seed documents, the densest N, or everything).
- **`src/single_instance.rs`** — Single-instance guard (Windows). The first launch holds a per-user named mutex and listens on a named pipe; a later launch detects the mutex, forwards its file path to the running instance (which opens it as a new tab and comes to the front), and exits before building any UI — so a second document reuses the existing process instead of spawning a whole new window and WebView2 group. A no-op on other platforms.
- **`src/tests.rs`** — The crate's unit tests, kept in one `#[cfg(test)] mod tests` file rather than inline in `lib.rs`. They reach the crate's public and `pub(crate)` surface through `use super::*`.

The WebView front-end that `app_shell_html()` serves lives outside the Rust source as editable assets, embedded at build time with `include_str!`:

- **`src/assets/app-shell.html`** — the page markup (app bar, library pane, glossary sheet, settings menu).
- **`src/assets/app-shell.js`** — the in-page application script (tabs, history, minimap, library, the [code view](../01-features/07-editing.md#code-view) editor surface, the PixiJS + d3-force [graph](../01-features/03-library.md#graph) scene, theme and locale wiring). Keeping the markup and script as real `.html` / `.js` files means normal front-end tooling applies, while the binary stays self-contained.

## Rendering pipeline

When a user opens a `.md` file, the following sequence runs entirely on the Rust side before any content reaches the WebView:

**1. Read the file**

`load_document()` or `opened_document_from_markdown()` in `lib.rs` reads the Markdown source from disk.

**2. Parse with pulldown-cmark**

`render_markdown_document()` parses the Markdown using `pulldown-cmark` with `Options::ENABLE_TABLES`, `ENABLE_STRIKETHROUGH`, `ENABLE_TASKLISTS`, `ENABLE_GFM`, `ENABLE_FOOTNOTES`, and `ENABLE_MATH` enabled.

**3. Apply GitHub extras**

A pipeline of event transformers adds heading IDs, linkifies plain URLs, resolves GitHub issue/PR/commit references and emoji shortcodes, renders syntax-highlighted fenced code blocks via `syntect`, and handles footnote back-references.

**4. Sanitize with ammonia**

The raw rendered HTML is passed through `ammonia` with an allowlist of GFM-safe tags and attributes. Scripts, styles, event handlers, and dangerous URLs are stripped before the WebView ever sees the content. Attributes prefixed `data-leaf-` / `data-src-` are allowed through on every tag — the [editing](../01-features/07-editing.md) model's source-range markers, which carry no script and never reach a URL context.

**5. Inject initial settings**

`initial_settings_script()` produces `window.__leafSettings = {...}` from the persisted `Settings` struct. This script is registered as a WebView initialization script so the theme and library pane render from saved state on the very first paint — no flash of defaults.

**6. Load into the WebView**

`app_shell_html()` generates the full HTML/CSS/JS shell. `reading_mode_css()` assembles the complete style block: Primer CSS primitives + compiled theme CSS + application CSS. Fonts are not bundled — the active [theme](../01-features/06-themes.md#fonts) fetches its font from Google Fonts on demand. The rendered document HTML is injected into the shell via `workspace_state_script()` or `workspace_switch_script()`, which call the appropriate `window.leaf*` JavaScript entry points.

## TEI XML rendering pipeline

When a user opens a `.xml` file, `load_document()` detects the extension and calls `load_xml_document()` instead of the Markdown path:

**1. Parse with roxmltree**

`load_xml_document()` in `lib.rs` reads the XML source and parses it with `roxmltree` into a read-only DOM.

**2. Pick the title and find the TEI body**

`render_tei_body()` first reads every `titleStmt > title` and picks the document title by `type` and `xml:lang` — English main title, falling back to the English long title, then the first non-Tibetan title. The Sanskrit main title and the English and Sanskrit long titles render beneath the heading as a muted subtitle block; Tibetan titles are never shown. It then locates the `<text> > <body>` element and walks its child `<div>` elements recursively.

**3. Emit HTML**

`tei_render_div()` / `tei_render_node()` convert TEI elements to HTML equivalents: `<div type="chapter">` → heading, `<p>` → paragraph, `<lg><l>` → verse, `<note place="end">` → footnote reference collected in a `TeiCtx`. Heading slugs are produced by `tei_slugify()` to match the same GitHub-style slug algorithm used for Markdown headings.

**4. Append footnotes**

After traversal, any collected footnotes are appended as a `<section class="footnotes"><ol>…</ol></section>`, identical to the Markdown footnote format so the same CSS styles them.

**5. Auto-link glossary (optional)**

`auto_link_glossary()` walks up from the document's folder to the nearest `GLOSSARY.md` (the same lookup the `glossary:` sheet links use), then wraps matched terms with `<a href="glossary:slug">` anchors — skipping text already inside a link, `code`, or `pre`. The identical pass runs for Markdown documents (the glossary file itself is exempt, so its entries are not self-linked).

**6. Inject into shell**

The finished HTML is handed to `app_shell_html()` and injected into the WebView exactly as Markdown output is — themes, minimap, pager, and scroll anchoring all apply unchanged.

## IPC bridge

Communication between the JavaScript running in the WebView and the Rust host uses `wry`'s IPC mechanism. JavaScript calls `window.ipc.postMessage(JSON.stringify(message))`. Rust deserializes the body into an `IpcCommand` enum using `serde_json`, then dispatches it as a `UserEvent` on the `tao` event loop.

Key `IpcCommand` variants include:

| Command                | Triggered by                          |
| ---------------------- | ------------------------------------- |
| `open`                 | "Open" button or `Ctrl+O` / `Cmd+O`   |
| `openRecent`           | Recent file list click                |
| `closeTab`             | Tab close button or `Ctrl+W`          |
| `switchTab`            | Tab click                             |
| `moveTab`              | Tab drag-and-drop reorder             |
| `goBack` / `goForward` | History buttons or keyboard shortcuts |
| `openLink`             | In-document link click                |
| `openGlossary`         | Glossary link click (opens the term in a bottom sheet) |
| `openExternal`         | The "update available" button: open the release page in the system browser (unattached to any document) |
| `countLines`           | Link hover: read the linked document and report its line count for the tooltip |
| `setThemeFamily`       | Theme family button in the theme picker |
| `setThemeMode`         | Appearance control in the theme picker |
| `setThemeRandomBag`    | The [Random theme](../01-features/06-themes.md#random) draw: persist the families already shown in the current no-repeat cycle |
| `setMinimapEnabled`    | Minimap toggle in Settings menu       |
| `setPagerEnabled`      | Pager toggle in Settings menu         |
| `setSpeedReaderEnabled` | Speed Reader toggle in Settings menu |
| `setLineNumbersEnabled` | Line-numbers toggle in Settings menu |
| `setReaderEditingEnabled` | Reading-view editing toggle in Settings menu |
| `setIndexingEnabled`   | "Index entire device" toggle          |
| `getFileTree`          | Boot-time library pane initialization |
| `getGraph`             | Build the library link graph for the current scope + focus seeds |
| `setGraphScope`        | Graph size picker in Settings menu    |
| `loadPager`            | Request the Previous / Next pager after a document renders |
| `enterCodeView`        | The [code view](../01-features/07-editing.md#code-view) toggle: show the document's raw source |
| `exitCodeView`         | Toggle back from the code view to the rendered reading view |
| `updateSource`         | Debounced code-view edit: the full buffer text, for re-highlight and dirty tracking |
| `saveDocument`         | The green [Save](../01-features/07-editing.md#save) button or `Ctrl+S` / `Cmd+S`: write the edit buffer to disk |
| `editBlock`            | An [inline reading-view edit](../01-features/07-editing.md#inline-editing-the-reading-view): splice new text over a block's source byte range |
| `toggleTask`           | A reading-view [task checkbox](../01-features/07-editing.md#inline-editing-the-reading-view) click: flip the Nth `[ ]`/`[x]` marker |
| `undoEdit`             | The [Undo](../01-features/07-editing.md#undo) button or `Ctrl+Z` / `Cmd+Z`: revert the most recent reading-view edit |
| `search`               | Library search box query (optionally scoped to the shown documents) |
| `revealFile`           | File row context menu: reveal in file manager |
| `copyFile`             | File row context menu: cut/copy the file to the clipboard |
| `copyPath`             | File row context menu: copy the file path as text |
| `renameFile`           | File row context menu: inline rename |
| `deleteFile`           | File row context menu: move to Recycle Bin / Trash |
| `showProperties`       | File row context menu: OS file properties |
| `goHome`               | Clicking the leaftext logo            |
| `setLibraryState`      | Library view / expanded folders change |
| `setLibraryLayout`     | Library pane resize or collapse       |
| `setWindowChrome`      | Theme change repainting the title bar and window border (Windows) |

Results flow back from Rust to JavaScript via `webview.evaluate_script()`, calling `window.leafSetState()`, `window.leafSwitchTab()`, `window.leafReloadDocument()`, `window.leafSetNavigation()`, `window.leafSetLibraryState()`, `window.leafShowGlossary()`, `window.leafShowCodeView()`, `window.leafSourceUpdated()`, `window.leafSaved()`, and related entry points.

## Key data structures

The following types in `main.rs` model the reader's stateful document management:

- **`Workspace`** — holds `Vec<Tab>` (all open tabs) and `active: Option<usize>` (the currently visible tab index, or `None` when the home screen is showing).
- **`Tab`** — holds a `DocumentHistory`, a `ScrollHistory`, a `title` string (cached for the tab bar), an `Option<ScrollAnchor>` (the last saved reading position), an `Option<f64>` (the last saved code-view scroll fraction, restored when you return to a tab left in the [code view](../01-features/07-editing.md#code-view)), an `Option<EditableDocument>` (the [edit buffer](../01-features/07-editing.md#editing-the-source), created the first time the document is edited — inline in the reading view or via the code view — and kept so unsaved edits survive view toggles and tab switches), and a `code_view` flag for which view the tab is showing.
- **`DocumentHistory`** — a `Vec<PathBuf>` of visited paths with a current index. Supports `go_back()`, `go_forward()`, and `forget_current()` (used when a file fails to open).
- **`ScrollHistory`** — two `Vec<ScrollAnchor>` stacks (`back_entries` and `forward_entries`) that record in-document scroll jumps independently from document-level navigation.
- **`ScrollAnchor`** — `{ section: Option<String>, block: u32, offset_y: f64 }`. A render-stable position: the nearest heading `id` above the reader's top edge, the block ordinal within that section, and the signed pixel offset. Survives a full re-render because the same Markdown always produces the same block sequence.
- **`FileWatch`** — a debounced `notify` watcher (200 ms window) pointed at the active document's parent directory. Watching the parent rather than the file itself survives editors that save by atomic rename.

## Local image protocol

`local_image_protocol_response()` in `markdown.rs` serves local image files under the `leaf-image://` custom URL scheme (or `http://leaf-image.local/` on platforms where custom protocols are restricted, such as Windows and Android).

Before serving any bytes, it validates that the requested path resolves to within the **access root** — the parent of the currently opened document's directory. Requests that escape this scope return `403 Forbidden`; missing files return `404 Not Found`. This scoped access model lets documents reference sibling and parent-directory images via relative paths (including `../`) without exposing the full filesystem.

## Bundled asset protocol

A second custom scheme, `leaf-asset://` (`http://leaf-asset.local/` where custom protocols are restricted), served by `bundled_asset_response()` in `assets.rs`, provides the renderer's vendored runtimes — the Mermaid bundle, the KaTeX script and stylesheet, the KaTeX WOFF2 fonts, and the PixiJS + d3-force bundles behind the [Graph view](../01-features/03-library.md#graph) — straight from bytes compiled into the binary with `include_bytes!`. Diagrams, math, and the graph therefore render fully offline, with no CDN dependency. The Content-Security-Policy restricts script sources to `'self'` plus this protocol; style and font sources also allow Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`), from which the active [theme](../01-features/06-themes.md#fonts) fetches its font. The graph runtimes load lazily — only the first time the graph view opens — and a Pixi companion bundle swaps its `new Function` shader/uniform paths for eval-free polyfills so it runs under that CSP.
