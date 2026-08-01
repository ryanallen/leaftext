# Architecture

> Leaftext is a Rust desktop app using tao for windowing and wry for WebView. The Markdown pipeline, the IPC bridge, the vault registry, and the git integration are all covered here.

Leaftext is a single Rust binary that embeds a WebView (via `wry`) inside a native window (via `tao`). The Markdown rendering pipeline runs on the Rust side; the result is injected into the WebView as HTML. All user interaction — opening files, navigating history, adjusting settings — flows through a typed IPC bridge between JavaScript running in the WebView and the Rust host.

## Core crates

| Crate                   | Role                                                 |
| ----------------------- | ---------------------------------------------------- |
| `tao`                   | Native windowing and event loop                      |
| `wry`                   | WebView embedding (WKWebView / WebView2)             |
| `pulldown-cmark`        | CommonMark + GFM Markdown parser                     |
| `syntect` + `two-face`  | Syntax highlighting for code blocks                 |
| `ammonia`               | HTML sanitization (allowlist-based)                  |
| `rusqlite` (bundled)    | SQLite for the [vault](../01-features/03-library.md#vaults) registry |
| `rfd`                   | Native file dialogs                                  |
| `serde` / `serde_json`  | IPC message serialization                            |
| `notify-debouncer-mini` | Filesystem watcher for live reload and the [library pane](../01-features/03-library.md#live-updates) |
| `blake3`                | Content hashing: re-checking a staged installer before it runs |
| `roxmltree`             | Read-only XML DOM parsing for TEI and other XML      |
| `yaml-rust2`            | YAML parsing for the [data renderer](../01-features/01-rendering.md#data-files-json-and-yaml). JSON needs no crate — `src/data.rs` reads it directly, which is what keeps key order and exact byte ranges |
| `mail-parser`           | MIME parsing for the [email renderer](../01-features/01-rendering.md#email-eml): multipart trees, base64/quoted-printable bodies, encoded-word headers, per-part charsets |
| `windows-sys` (Windows) | Win32 calls: single-instance guard, clipboard, Recycle Bin, the WinHTTP update download, waiting for the app to exit before an update installs |

The list is deliberately short. Clipboard, Recycle Bin, per-user data paths, update downloads, and [git](../01-features/03-library.md#github-sync) are all done against the platform rather than through a crate — see [Dependencies](../../AGENTS.md) for the standing policy, and `src/platform.rs` for where the native code lives.

Features are trimmed for the same reason. `syntect` is taken with `default-features = false` and only `parsing`, `html`, and `regex-onig`: its syntax definitions come from `two-face`'s binary dumps, so its own bundled syntax and theme dumps are dead weight, and its `yaml-load` feature — which reads `.sublime-syntax` YAML and was the only thing pulling in the unmaintained `yaml-rust` — is not needed at all. `yaml-rust2` is likewise taken without its `encoding` feature, since files reach it as decoded Rust strings.

## Source files

Leaftext's Rust source is split by concern. Where a concern grew past one file it became a directory whose `mod.rs` holds the shared vocabulary and the pipeline that orders the stages, with one sibling file per stage. Both crate roots live in `src/` — `lib.rs` for the library, `main.rs` for the binary — so the binary's modules sit under `src/app/` to keep the two namespaces apart.

- **`src/main.rs`** — Entry point. Builds the window and the WebView2 instance, registers the custom protocol handlers, and runs the startup sequence that assembles the event loop's state. It tunes WebView2 with a trimmed browser-argument set (site isolation and background networking off, GPU and the renderer kept hot) to reduce the process/background footprint of a single-window offline reader.
- **`src/app/`** — The binary's guts. `event_loop.rs` holds `AppCtx` (the state the loop owns between events) and the loop itself: one arm per thing the window, the page or the watcher can report. Around it, `events.rs` (`IpcCommand` — the page's whole vocabulary — plus `UserEvent` for the app's own signals, the IPC bridge, and `off_loop`, the one way work is handed to a worker thread), `workspace.rs` (`Workspace` and `Tab` — a new tab inherits the [source view](../01-features/07-editing.md#code-view) from the one you were in), `history.rs` (back/forward and the scroll position each entry remembers), `watch.rs` (the `FileWatch` live-reload watcher), `vaults.rs` (the vault switcher, the folder reads, and the corpus's lifecycle), `vault_git.rs` (the [GitHub panel](../01-features/03-library.md#github-sync)'s four jobs, each on its own thread), `editing_cmds.rs`, `code_intel.rs` (gathers what a [typing help](../01-features/07-editing.md#typing-help) ask needs — the corpus or the document's folder, the edit buffer — and computes the answer on a worker), `render.rs` (`Reader`: the window, the page, the tabs and the recents that every render needs, bundled so a render is one call, plus the per-tab render cache), `glossary.rs`, `links.rs` (what a clicked href means), `fileops.rs`, and `update_flow.rs`.
- **`src/lib.rs`** — Core document rendering and app-state helpers. Contains `render_markdown_document()` (which orchestrates the Markdown pipeline in `markdown/`), document loading, glossary auto-linking, recent-files and settings persistence, and `app_shell_html()`, which assembles the WebView page from the shell markup and script fragments in `src/assets/` (see below) and substitutes runtime tokens.
- **`src/format.rs`** — `DocumentFormat` and the single table of readable formats and their extensions. Everything that has to know what counts as a document asks this one: the Open dialog's filters, drag and drop, whether a clicked link opens in the reading view or goes to the OS, the [pager](../01-features/02-navigation.md#pager)'s page list, the [library](../01-features/03-library.md)'s indexable set, and the render router's choice of pipeline. `for_path()` answers whether a file can be opened at all (`None` if not); `from_path()` answers which renderer to use, falling back to Markdown so an extension-less `README` still opens. Adding a format is one arm here — the matches on it are exhaustive on purpose, so the compiler names every site that must account for it. Public, re-exported at the crate root.
- **`src/scripts.rs`** — Generators for the small JS snippets the host injects to drive the WebView: initial/document/workspace state, navigation, scroll anchoring (`ScrollAnchor`), the glossary sheet, and error state. Each returns a `String` of `window.leaf*(...)` calls that the event loop hands to `webview.evaluate_script()`. The state is written out as a JavaScript value. Handing it over as `JSON.parse("…")` instead was tried and is slower here: that trick wins on dense object structure and loses on long strings, because the text is scanned and unescaped once as a JS string before the JSON reader sees it — and a document payload is mostly two very large strings, the rendered HTML and the source.
- **`src/pager.rs`** — The Previous/Next pager: walks the document's folder tree in reading order (`document_pager_html()`, `PagerEntry`, `pager_label()`) and builds the pager HTML plus the async `pager_loaded_script()` hand-off.
- **`src/xml.rs`** — The XML front door and the generic renderer. `render_xml_document()` / `render_xml_body()` / `xml_block_source_map()` parse once (`parse_xml()`, doctypes allowed) and route by content: a `<TEI>` root or a `<teiHeader>` goes to `src/tei.rs`, anything else renders here. The generic renderer has no schema to work from, so it reads the shape of the tree — an element holding only text becomes a label/value field, runs of them share one field list, repeated flat records become a table, an element holding other elements becomes a section headed by its `<title>`/`<name>` child or its humanized tag name, and mixed content becomes a paragraph. Blocks that come from exactly one element carry that element's byte range, so [inline editing](../01-features/07-editing.md#inline-editing-the-reading-view) anchors the same way TEI's does. `pub(crate)` and re-exported at the crate root.
- **`src/tei.rs`** — The TEI XML renderer, reached through `src/xml.rs`: converts an 84000-style TEI document into the same HTML the Markdown pipeline produces (`render_tei_inner()`, `tei_render_div()` / `tei_render_node()`, `TeiCtx`, `tei_slugify()`). Stamps each editable block with inline `data-src-*` source byte ranges (from `roxmltree`'s `Node::range()`), so [inline editing](../01-features/07-editing.md#inline-editing-the-reading-view) works for XML too. `pub(crate)` and re-exported at the crate root.
- **`src/data.rs`** — The [JSON and YAML](../01-features/01-rendering.md#data-files-json-and-yaml) front door and their shared renderer. Both formats parse into one ordered `DataNode` tree (`parse_json()`, `parse_yaml()`) which `render_data_document()` renders through the same shape rules and label helpers `src/xml.rs` uses, so a sitemap and the JSON beside it read alike. The JSON reader is hand-written rather than a crate: it keeps key order, shows numbers as the file wrote them, tolerates comments and trailing commas, and — because it knows exactly where each value begins and ends — gives every node an exact byte range. The YAML reader drives `yaml-rust2`'s event stream, resolving `*alias` references and splicing `<<:` merge keys, converting the scanner's *character* markers to byte offsets as it goes. A block is stamped with `data-src-*` only where its range is provable (`plain_scalar_span()` checks a plain scalar's source text against its parsed value), because the reading view splices that range verbatim. `pub(crate)` and re-exported at the crate root.
- **`src/eml.rs`** — The [email](../01-features/01-rendering.md#email-eml) renderer for `.eml` (and `.mht`/`.mhtml`, the same MIME envelope). `render_eml_document()` parses the message with `mail-parser`, then builds the page: the subject as heading, a From/To/Cc/Date field list with `mailto:` links, the HTML body through the same `ammonia` policy Markdown's raw HTML crosses (plus the `cid:` scheme, kept only long enough for the pass after sanitizing to swap each inline-image reference for a `data:` image built from the message's own parts), a linkified-paragraph fallback for plain-text bodies, and an attachment list. Nothing reaches the network. Bodies are transfer-coded in the source, so no block carries a provable range and the block map is empty — the code view edits the raw message. `pub(crate)` and re-exported at the crate root.
- **`src/minimap.rs`** — The document minimap model: `build_minimap_model()` / `build_minimap_model_from_html()` and the `DocumentMinimap` / `MinimapSpan` types that classify each line run (heading, paragraph, list, blockquote, code fence) for the scrollable overview. Only `line_count` is serialized to the page — the [rail](../01-features/04-minimap.md#how-it-works) draws itself from a clone of the real rendering, so the spans would be megabytes of payload nothing reads. `pub(crate)` internals with the public model types re-exported at the crate root.
- **`src/editing.rs`** — The [editing](../01-features/07-editing.md) model: `EditableDocument` (the per-tab source buffer with dirty tracking, a save version counter, `replace_range()` splices for inline edits, `toggle_task()` for checkbox flips, and the bounded [undo](../01-features/07-editing.md#undo) stack), `block_source_map()` — a `pulldown-cmark` `into_offset_iter()` pass mapping each top-level Markdown block to its exact source byte range — and `task_marker_offsets()` for the interactive checkboxes. These source maps are what [inline editing](../01-features/07-editing.md#inline-editing-the-reading-view) anchors its splices to. Public types re-exported at the crate root.
- **`src/encoding.rs`** — What a file's bytes mean as text, and the one way a document is read from or written to disk (`read_source()` / `write_source()`). `decode_source()` reads the byte order mark to pick a decoder — UTF-8, UTF-16 or UTF-32, either byte order — falls back to Windows-1252 for unmarked bytes that are not valid UTF-8, and refuses anything holding a zero byte as not being text. `encode_source()` writes the file back the way it was read, so saving never re-spells a document. A leading mark is taken off the text and remembered on the `SourceSpelling` instead of left in it, because a `U+FEFF` at offset zero makes `pulldown-cmark` read the first line as a paragraph, stops `---` opening frontmatter, and makes `serde_json` refuse the document. All `std` — no encoding crate. Public and re-exported at the crate root. See [file encodings](../01-features/01-rendering.md#file-encodings).
- **`src/assets.rs`** — Bundled-asset serving and icon processing: the `include_bytes!` Mermaid/KaTeX runtimes, the Monaco editor behind the [code view](../01-features/07-editing.md#editing-the-source), and the PixiJS + d3-force bundles that power the [Graph view](../01-features/03-library.md#graph), `bundled_asset_response()` for the `leaf-asset://` scheme, the toolbar/brand SVG constants, and `normalize_svg_icon_colors()` (rewrites literal icon colors to `currentColor`). Not to be confused with the `src/assets/` directory it embeds. `pub(crate)` (plus the public `bundled_asset_response` / `BundledAsset` / `LOCAL_ASSET_PROTOCOL`), re-exported at the crate root.
- **`src/markdown/`** — The Markdown rendering pipeline. `mod.rs` runs the stages in order; `events.rs` transforms the event stream between parse and render, `headings.rs` does heading anchors and document titles, `github.rs` the GitHub extras (autolinks, issue/PR references, emoji, alerts, repo context), `footnotes.rs`, `code.rs` the `syntect` highlighting — including `SYNTAX_STYLE_RULES`, the table of every `.syn-` rule the stylesheet has, which is what lets a highlighted token be one flat element carrying only the classes some rule needs — `images.rs` image URL resolution, `image_size.rs` the pixel size read out of each local image's own header and stamped onto the tag — after the sanitizer, since the numbers are the app's own — so the page reserves the right space before the picture decodes, `image_protocol.rs` the `local_image_protocol_response()` handler for the `leaf-image://` custom scheme, and `paths.rs` percent-coding. Two files carry the sanitizer: `rawhtml.rs` decides what raw HTML inside Markdown may keep and configures `ammonia`, and `htmlparse.rs` does the tag and attribute scanning underneath it — no policy, and no dependency on anything else in the crate. Items are `pub(crate)` and re-exported at the crate root.
- **`src/theme.rs`** — The theme system. The semantic token contract (`LEAF_SEMANTIC_TOKEN_CONTRACT`), the `ThemeSource` / `ThemeFile` types, and the CSS compiler: `theme_sources()` (which parses the bundled `src/assets/themes.md` once via `parse_theme_markdown()` and leaks it to `&'static`), `compiled_theme_css()`, `theme_source_token_value()`, `assert_theme_sources_cover_contract()`, and `reading_mode_css()` — which prepends the compiled token blocks to the stylesheet in `src/assets/reading.css`, so every `var(--leaf-*)` in it resolves. Palettes are data, not code, and so is the stylesheet: neither lives in Rust tables. Its items are `pub(crate)` and re-exported at the crate root. See [theming](04-theming.md).
- **`src/store/`** — The [vault](../01-features/03-library.md#vaults) registry, and the two parsers that go with it. `vaults.rs` holds the rows (add, rename, re-root, remove, and `vault_containing()`, which answers which vault holds a path — innermost wins); `db.rs` opens `manifest.db` and migrates its schema. `frontmatter.rs` and `links.rs` take text and give back fields and link targets; neither ever needed a table, which is why they outlived the one they were written for. A [web address](../01-features/03-library.md#web-addresses) is one of those targets (`DocLink::target_url`, deduped by `normalize_url`, named by `url_host_label`), and bare URLs are found by `markdown::plain_text_urls` — the same finder the renderer linkifies with, so a link the reader can click is a link the graph draws. `mod.rs` holds the shared shapes (`FileTreeNode`, `DocumentGraph`, `GraphEdge` — directed, with `mutual` for a pair that links both ways — `SearchHit`) and the path helpers. The crate's only public module.
- **`src/folder_tree.rs`** — The [library pane](../01-features/03-library.md#file-tree)'s files. `read_folder_listing(root, path)` returns one directory's immediate children plus the trail down to it; the top is the active vault's folder, or the drive roots. Nothing below is touched, so nothing is walked that nobody opened.
- **`src/vault_corpus.rs`** — The vault's text, in memory. One read serves both things that must see inside every document: `graph()` builds the [link map](../01-features/03-library.md#graph) and `search()` answers the [search box](../01-features/03-library.md#search). There is no index behind it, so the files are the only copy of the truth and this is a cache the watcher patches a file at a time (`refresh()`, which reports whether the patch changed anything — the answer decides whether a map on screen is redrawn). Dropped on a vault switch and on quit; capped at 5,000 documents. `build_graph()` and `narrow()` are free functions rather than methods, because a map of one document is built from the same two and differs only in which documents it gathers.
- **`src/doc_graph.rs`** — The [link map](../01-features/03-library.md#graph) around one document, for a document no vault holds. `document_graph(seed, request)` reads that document, the documents in its folder (one level), and whatever it links to — so the work is bounded by the document's link count rather than by the disk under it. Nothing is cached: the vault's text is held because reading it costs thousands of files, and this costs one folder. This is what replaced the old "fall back to whatever folder the pane is showing", where opening the map at `C:\` walked the drive; and it is why the graph needs no vault, which it wrongly did in v0.1.407.
- **`src/code_intel.rs`** — What the code view's [typing help](../01-features/07-editing.md#typing-help) knows — Monaco raises the IntelliSense widgets, this answers them: note lists for `[[` completion (`corpus_note_items()` / `folder_note_items()`), a document's headings with the renderer's own anchors (`document_headings()` runs the same pipeline that stamps heading ids, so a completed `](#anchor)` always lands), note lookup and hover previews (`find_note()`, `read_folder_note()`, `note_preview()`), and the broken-link check (`lint_links()`, built on the same `document_links()` scan the graph draws from — `DocLink::span` places each link, and the markers come back in the editor's own 1-based UTF-16 coordinates). Answers come from the vault's corpus when it holds the document, or the document's own folder otherwise — never more of the disk than the graph reads. Public functions re-exported at the crate root.
- **`src/git.rs`** — [GitHub sync](../01-features/03-library.md#github-sync). Shells out to the machine's own `git` rather than speaking the protocol, for the same reason `src/platform.rs` shells out to `msiexec`: the user's git already knows who they are and how to sign in, and a crate would ship a second copy of all of it. `git_tooling()` reports what is installed, `inspect_vault_repo()` reads a folder's standing (a repository at the root, one it sits inside, ones below it, and the ahead/behind counts), `init_vault_repo()` / `create_repo_on_github()` / `link_vault_remote()` are the two routes onto GitHub, and `sync_vault_repo()` commits, rebases and pushes — undoing a conflicted rebase before it returns. Creating the repository is the one thing git cannot do, so `gh` is used where it is installed and the browser where it is not; no token is ever held here. The output parsers (`commit_message()`, `remote_label()`, `repo_name_for_vault()`, `parse_ahead_behind()`) are pure and unit-tested.
- **`src/single_instance.rs`** — Single-instance guard (Windows). The first launch holds a per-user named mutex and listens on a named pipe; a later launch detects the mutex, forwards its file path to the running instance (which opens it as a new tab and comes to the front), and exits before building any UI — so a second document reuses the existing process instead of spawning a whole new window and WebView2 group. A no-op on other platforms.
- **`src/platform.rs`** — Native OS integration, so no crate is carried for it: the clipboard and the Recycle Bin (Win32 `SetClipboardData` and `SHFileOperationW` on Windows, `pbcopy` and Finder on macOS), the installer download (`download_to()`, WinHTTP on Windows and the bundled `curl` on macOS, both using the OS certificate store), and the update applier — a detached copy of the binary that waits for the app to exit, re-verifies the staged installer, runs it, records whether it worked, and relaunches. Nothing here touches a copy left by another install context: two attempts at that each shipped broken, so the release notes ask instead.
- **`src/updater.rs`** — The staging model for [updates](../01-features/05-settings.md#updates): where a download lands, the length it must arrive at, the manifest a later launch reads it back from, and the record the applier leaves saying how the install went. `update_url_is_allowed()` holds the download to HTTPS and GitHub's own hosts, because the URL arrives from the network by way of the page and is handed to a native client that has no same-origin rule behind it.
- **`src/tests/`** — The library's unit tests, one file per subject with the shared helpers in `mod.rs`, rather than inline in `lib.rs`. They reach the crate's public and `pub(crate)` surface through `use super::*`. The binary's own tests are `src/app/tests.rs`, and the store's are `src/store/tests.rs`.

The WebView front-end that `app_shell_html()` serves lives outside the Rust source as editable assets, embedded at build time with `include_str!`:

- **`src/assets/app-shell.html`** — the page markup (app bar, library pane, glossary sheet, settings menu).
- **`src/assets/shell/`** — the in-page application script, as ordered fragments: the app bar and tabs, the library pane and its search, the PixiJS + d3-force [graph](../01-features/03-library.md#graph) scene, the [code view](../01-features/07-editing.md#code-view) and the Monaco editor it hosts, its [typing help](../01-features/07-editing.md#typing-help) (the completion, hover, and broken-link providers, each answered by the host over one token-matched IPC round trip) and its [pinned headings](../01-features/07-editing.md#pinned-headings) (drawn over the editor rather than by Monaco, so they can sit above the page's edge fade), the reading-view editor and its DOM-to-Markdown conversion, the [block gutter](../01-features/07-editing.md#the-block-gutter) and the [format bar](../01-features/07-editing.md#the-format-bar), the [flowchart editor](../01-features/07-editing.md#the-flowchart-editor) in two fragments (`flow-model.js` the Mermaid grammar and the graph, with no DOM in it so the shell check can run it; `flow-canvas.js` the sheet, which renders the canvas with the same bundled Mermaid the page uses and measures the result to lay its handles over it — there is no layout or shape-drawing of ours between them), the minimap and reader scroll anchoring, the glossary sheet, theme wiring, and the updater. They are **one script, not modules**: `APP_SHELL_SCRIPT_PARTS` in `lib.rs` concatenates them in order and they share one scope, because the page has no module loader. Order is therefore load-bearing — `state.js` comes first and holds only what more than one fragment touches, and the last fragment ends with the bootstrap call that must run after everything else is defined. `just check-shell` runs the whole script against a stand-in page, so a fragment that throws as it loads fails the build rather than opening a blank window.
- **`src/assets/reading.css`** — the whole app stylesheet, served as `app.css` over `leaf-asset://` with the theme compiler's token blocks prepended.
- **`src/assets/theme-bootstrap.js`** — injected inline before first paint, so the theme resolves on the first frame rather than flashing the wrong one. Interface wording lives in the markup and the shell fragments, so there is nothing to look up before text appears.
- **`src/assets/themes.md`** — every theme's [palette as data](04-theming.md#palettes-are-data-themesmd), parsed once at startup. It's compiled from the editable `themes/` folder (one Markdown file per family, globbed) by `scripts/bundle-themes.mjs`; `just check-themes` guards the two against drift.

## Rendering pipeline

When a user opens a `.md` file, the following sequence runs entirely on the Rust side before any content reaches the WebView:

**1. Read the file**

`load_document()` or `opened_document_from_markdown()` in `lib.rs` reads the Markdown source from disk.

**2. Parse with pulldown-cmark**

`render_markdown_document()` parses the Markdown using `pulldown-cmark` with `Options::ENABLE_TABLES`, `ENABLE_STRIKETHROUGH`, `ENABLE_TASKLISTS`, `ENABLE_GFM`, `ENABLE_FOOTNOTES`, and `ENABLE_MATH` enabled.

**3. Apply GitHub extras**

A pipeline of event transformers adds heading IDs, linkifies plain URLs, resolves GitHub issue/PR references and emoji shortcodes, renders syntax-highlighted fenced code blocks via `syntect`, and handles footnote back-references.

**4. Sanitize with ammonia**

The raw rendered HTML is passed through `ammonia` with an allowlist of GFM-safe tags and attributes. Scripts, styles, event handlers, and dangerous URLs are stripped before the WebView ever sees the content. Attributes prefixed `data-leaf-` / `data-src-` are allowed through on every tag — the [editing](../01-features/07-editing.md) model's source-range markers, which carry no script and never reach a URL context.

**5. Inject initial settings**

`initial_settings_script()` produces `window.__leafSettings = {...}` from the persisted `Settings` struct. This script is registered as a WebView initialization script so the theme and library pane render from saved state on the very first paint — no flash of defaults.

`load_settings()` returns a `SettingsLoad`: the settings themselves plus whether a file was there that did not parse. The two are separated because they are otherwise indistinguishable — an unreadable file and no file at all both end in `Settings::default()`, so the app opens looking factory-fresh with nothing to say that someone's saved choices were skipped. `settings_unreadable_script()` carries that flag to the page as `window.__leafSettingsUnreadable`, and the boot growls once when it is true. A leading UTF-8 byte order mark is not one of those cases: Windows editors write one by default, so `read_config_text()` looks past it for both [config files](../01-features/05-settings.md#files).

**6. Load into the WebView**

`app_shell_html()` generates the full HTML/CSS/JS shell. `reading_mode_css()` assembles the complete style block: compiled theme CSS (from the bundled `themes.md`) + the `:root` alias layer + application CSS. Fonts are not bundled — the active [theme](../01-features/06-themes.md#fonts) fetches its font from Google Fonts on demand. The rendered document HTML is injected into the shell via `workspace_state_script()` or `workspace_switch_script()`, which call the appropriate `window.leaf*` JavaScript entry points.

## XML rendering pipeline

When a user opens a `.xml` file, `load_document()` detects the extension and calls `load_xml_document()` instead of the Markdown path:

**1. Parse with roxmltree**

`load_xml_document()` in `lib.rs` reads the XML source and `parse_xml()` in `xml.rs` parses it with `roxmltree` into a read-only DOM. Doctypes are allowed through (plists, XHTML and DocBook all carry one); roxmltree reads only the internal subset and never fetches anything. A file that isn't well-formed renders as a parse-error line naming the position, so the reader can go fix it.

**2. Route by content**

`render_xml_document()` sends a document with a `<TEI>` root or a `<teiHeader>` to the TEI renderer below, and everything else — sitemaps, RSS and Atom feeds, POMs, plists, exports, config files — to the generic renderer in `xml.rs`. The generic renderer works from the shape of the tree rather than any schema:

- an element holding only text (or only attributes) becomes a label/value field, and consecutive ones share a single two-column field list;
- two or more sibling records with the same tag, made only of short leaf values, become one table — a sitemap's `<url>` entries, a POM's `<dependency>` list;
- an element holding other elements becomes a section, headed by its own `<title>`/`<head>` child, by `Tag: name` for a `<name>` child or naming attribute, or by its humanized tag name (`lastBuildDate` reads as "Last build date");
- an element mixing text and markup renders as a paragraph of its text.

A document that names no title of its own — a sitemap has nowhere to say what it is — is headed and titled by its file name. Values that are entirely a URL become links.

**3. Pick the title and find the TEI body** (TEI only)

`render_tei_inner()` first reads every `titleStmt > title` and picks the document title by `type` and `xml:lang` — English main title, falling back to the English long title, then the first non-Tibetan title. The Sanskrit main title and the English and Sanskrit long titles render beneath the heading as a muted subtitle block; Tibetan titles are never shown. It then locates the `<text> > <body>` element and walks its child `<div>` elements recursively.

**4. Emit HTML** (TEI only)

`tei_render_div()` / `tei_render_node()` convert TEI elements to HTML equivalents: `<div type="chapter">` → heading, `<p>` → paragraph, `<lg><l>` → verse, `<note place="end">` → footnote reference collected in a `TeiCtx`. Heading slugs are produced by `tei_slugify()` to match the same GitHub-style slug algorithm used for Markdown headings.

**5. Append footnotes** (TEI only)

After traversal, any collected footnotes are appended as a `<section class="footnotes"><ol>…</ol></section>`, identical to the Markdown footnote format so the same CSS styles them.

**6. Auto-link glossary (optional)**

`auto_link_glossary()` walks up from the document's folder to the nearest `GLOSSARY.md` (the same lookup the `glossary:` sheet links use), then wraps matched terms with `<a href="glossary:slug">` anchors — skipping text already inside a link, `code`, or `pre`. The identical pass runs for Markdown documents (the glossary file itself is exempt, so its entries are not self-linked).

**7. Inject into shell**

The finished HTML is handed to `app_shell_html()` and injected into the WebView exactly as Markdown output is — themes, minimap, pager, and scroll anchoring all apply unchanged.

## IPC bridge

Communication between the JavaScript running in the WebView and the Rust host uses `wry`'s IPC mechanism. JavaScript calls `window.ipc.postMessage(JSON.stringify(message))`. Rust deserializes the body into an `IpcCommand` using `serde_json` and forwards it unopened as `UserEvent::FromPage(...)` on the `tao` event loop, which handles it there. The command is described once: `UserEvent`'s own variants are only the signals the page cannot send — the watcher, a second launch, and answers coming back from worker threads.

Key `IpcCommand` variants include:

| Command                | Triggered by                          |
| ---------------------- | ------------------------------------- |
| `open`                 | "Open" button or `Ctrl+O` / `Cmd+O`   |
| `openRecent`           | Recent file list click                |
| `newDocument`          | The **+** in the app bar, or **New document** on the home screen: an empty [unsaved buffer](../01-features/07-editing.md#new-document) in a new tab, with no file behind it until the first save |
| `closeTab`             | Tab close button or `Ctrl+W`          |
| `switchTab`            | Tab click                             |
| `moveTab`              | Tab drag-and-drop reorder             |
| `goBack` / `goForward` | History buttons or keyboard shortcuts |
| `openLink`             | In-document link click                |
| `openGlossary`         | Glossary link click (opens the term in a bottom sheet) |
| `openExternal`         | The update button in its notify-only state: open the release page in the system browser (unattached to any document) |
| `countLines`           | Link hover: read the linked document and report its line count for the tooltip |
| `setThemeFamily`       | Theme family button in the theme picker |
| `setThemeMode`         | Appearance control in the theme picker |
| `setThemeRandomBag`    | The [Random theme](../01-features/06-themes.md#random) draw: persist the families already shown in the current no-repeat cycle |
| `setMinimapEnabled`    | Minimap toggle in Settings menu       |
| `setPagerEnabled`      | Pager toggle in Settings menu         |
| `setSpeedReaderEnabled` | Speed Reader toggle on the reading toolbar |
| `setReadingUnlocked`   | The reading view's [padlock](../01-features/07-editing.md#the-padlock) |
| `setCodeUnlocked`      | The source view's padlock, which is a separate switch |
| `updateChecked`        | A release check finished: reset the six-hour throttle |
| `updateDownload`       | The release the check found: fetch that URL natively, hash it, and stage it |
| `applyUpdate`          | The "Restart to update" button: launch the installer and exit |
| `getFolder`            | Read one folder for the [library pane](../01-features/03-library.md#file-tree) — its children and the trail down to it |
| `revealInLibrary`      | Opening a document: point the pane at whichever vault holds it and open its folder. A file in none un-roots the pane for the session without forgetting the vault you chose |
| `getGraph`             | Build the link graph for the current scope + focus seeds — over the active vault when it holds the open document, else over that document |
| `setGraphView`         | Whether the page is showing the [graph](../01-features/03-library.md#graph), so a change on disk knows whether a map is on screen |
| `setGraphScope`        | Graph size picker in Settings menu    |
| `createVault`          | **New vault…**: pick a folder and register it |
| `setActiveVault`       | Vault switcher: make one the library root (`0` is the whole library) |
| `renameVault`          | The vault settings panel's name field  |
| `changeVaultFolder`    | The vault settings panel: point a vault at a different folder |
| `removeVault`          | The vault settings panel: forget the vault, leaving the folder alone |
| `getVaultStatus`       | The header's [sync button](../01-features/03-library.md#syncing): read the folder's git state, off the network |
| `getVaultGit`          | Opening the vault's [GitHub panel](../01-features/03-library.md#github-sync): the folder's state plus what is installed |
| `createVaultRepo`      | **Create a private repo**: `git init`, commit, then `gh repo create --push` |
| `linkVaultRemote`      | The pasted repository address: point `origin` at it and push |
| `syncVault`            | **Sync**: commit, pull with a rebase, push |
| `loadPager`            | Request the Previous / Next pager after a document renders |
| `enterCodeView`        | The [code view](../01-features/07-editing.md#code-view) toggle: show the document's raw source |
| `exitCodeView`         | Toggle back from the code view to the rendered reading view |
| `spliceSource`         | Debounced code-view edit, as the range it replaced: offset, length removed, text inserted, plus the buffer's new length so the host can prove the two copies still agree |
| `updateSource`         | The whole buffer. Used for the first send, and to resynchronize if a `spliceSource` length check ever disagrees |
| `saveDocument`         | The green [Save](../01-features/07-editing.md#save) button or `Ctrl+S` / `Cmd+S`: write the edit buffer to disk. A buffer with no file yet goes through the OS Save dialog first |
| `setCodeIntelEnabled`  | The [typing help](../01-features/07-editing.md#typing-help) wand on the code view's toolbar: Monaco's IntelliSense on or off |
| `codeCompleteNotes`    | Typing `[[` in the code view: list the notes it can complete to |
| `codeCompleteHeadings` | Typing `[[note#` (that note's headings) or `](#` (the open document's anchors) |
| `codeHoverNote`        | Hovering a `[[wikilink]]` in the code view: fetch the note's opening lines |
| `codeLint`             | A pause after typing in the code view: check the buffer's links and answer with the ranges to underline |
| `editBlock`            | An [inline reading-view edit](../01-features/07-editing.md#inline-editing-the-reading-view): splice new text over a block's source byte range |
| `moveBlock`            | A [block gutter](../01-features/07-editing.md#the-block-gutter) drag: a run of sibling ranges in document order plus the slot moved from and to. The page sends the whole run because the page is what knows which blocks are siblings |
| `pickImage`            | The insert row's [image box](../01-features/07-editing.md#images): show the file picker and answer with a destination for the document to hold |
| `toggleTask`           | A reading-view [task checkbox](../01-features/07-editing.md#inline-editing-the-reading-view) click: flip the Nth `[ ]`/`[x]` marker |
| `undoEdit`             | The [Undo](../01-features/07-editing.md#undo) button or `Ctrl+Z` / `Cmd+Z`: revert the most recent reading-view edit |
| `search`               | Library search box query, over the active vault's text |
| `revealFile`           | File row context menu: reveal in file manager |
| `copyFile`             | File row context menu: cut/copy the file to the clipboard |
| `copyPath`             | File row context menu: copy the file path as text |
| `renameFile`           | File row context menu: inline rename |
| `deleteFile`           | File row context menu: move to Recycle Bin / Trash |
| `showProperties`       | File or folder context menu: OS properties view |
| `pasteFile`            | Folder context menu: [move or copy](../01-features/03-library.md#cut-copy-paste) what was cut or copied into that folder |
| `goHome`               | Clicking the Leaftext logo            |
| `setLibraryState`      | Entering a folder, or stepping back out of one |
| `setLibraryLayout`     | Library pane resize or collapse       |
| `setWindowChrome`      | Theme change repainting the window border and dark-mode flag (Windows) |
| `windowDrag`           | Frameless title bar: start moving the window (a press on empty app-bar space) |
| `windowMinimize` / `windowToggleMaximize` / `windowClose` | The custom minimize / maximize / close buttons on the frameless Windows title bar. A double-click on empty app-bar space also sends `windowToggleMaximize`, decided on the second press: dragging hands the window to a Windows move loop that swallows the page's `dblclick` |

Results flow back from Rust to JavaScript via `webview.evaluate_script()`, calling `window.leafSetState()`, `window.leafSwitchTab()`, `window.leafSetWorkspace()` (tabs with no document, for a tab opening straight into the [source view](../01-features/07-editing.md#code-view)), `window.leafReloadDocument()`, `window.leafSetNavigation()`, `window.leafSetLibraryFolder()`, `window.leafSetVaults()`, `window.leafSetVaultStatus()`, `window.leafSetVaultGit()`, `window.leafSetGraph()`, `window.leafSetSearchResults()`, `window.leafShowGlossary()`, `window.leafShowCodeView()`, `window.leafSourceUpdated()`, `window.leafSaved()`, `window.leafCodeIntelAnswer()` (every [typing help](../01-features/07-editing.md#typing-help) answer, matched to its ask by an echoed token), `window.leafRefreshImages()`, and related entry points.

## Key data structures

The following types model the reader's stateful document management. `Workspace` and `Tab` live in `src/app/workspace.rs`, the two history types in `src/app/history.rs`, `FileWatch` in `src/app/watch.rs`, and `ScrollAnchor` in `src/scripts.rs`:

- **`Workspace`** — holds `Vec<Tab>` (all open tabs) and `active: Option<usize>` (the currently visible tab index, or `None` when the home screen is showing).
- **`Tab`** — holds a `DocumentHistory`, a `ScrollHistory`, a `title` string (cached for the tab bar), an `Option<ScrollAnchor>` (the last saved reading position), an `Option<f64>` (the last saved code-view scroll fraction, restored when you return to a tab left in the [code view](../01-features/07-editing.md#code-view)), an `Option<EditableDocument>` (the [edit buffer](../01-features/07-editing.md#editing-the-source), created the first time the document is edited — inline in the reading view or via the code view — and kept so unsaved edits survive view toggles and tab switches), and a `code_view` flag for which view the tab is showing.
- **`DocumentHistory`** — a `Vec<PathBuf>` of visited paths with a current index. Supports `go_back()`, `go_forward()`, and `forget_current()` (used when a file fails to open).
- **`ScrollHistory`** — two `Vec<ScrollAnchor>` stacks (`back_entries` and `forward_entries`) that record in-document scroll jumps independently from document-level navigation.
- **`ScrollAnchor`** — `{ section: Option<String>, block: u32, offset_y: f64 }`. A render-stable position: the nearest heading `id` above the reader's top edge, the block ordinal within that section, and the signed pixel offset. Survives a full re-render because the same Markdown always produces the same block sequence.
- **`FileWatch`** — a debounced `notify` watcher (200 ms window) pointed at the active document's parent directory. Watching the parent rather than the file itself survives editors that save by atomic rename.

## Local image protocol

`local_image_protocol_response()` in `markdown/image_protocol.rs` serves local image files under the `leaf-image://` custom URL scheme (or `http://leaf-image.local/` on platforms where custom protocols are restricted, such as Windows and Android).

A path is resolved against the open document's directory and then read: a relative destination at any depth (`../../imgs/pic.png`), an absolute path, or a `file://` URL all work, so a document's images can live anywhere on disk. Missing files return `404 Not Found`; a read the OS itself refuses returns `403 Forbidden`.

URL segments carry the shape of the path. `__leaf_parent__` stands in for each `..` step, and `__leaf_absolute__/<encoded path>` carries a whole absolute path for images that do not sit under the document's directory. Because a Windows drive letter parses as a one-character URL scheme, `parse_image_destination_url()` treats a single-letter scheme as a path rather than a URL.

Responses carry `Cache-Control: no-store`, and the page adds a `?leaf-epoch=<n>` query — bumped on every render, and again whenever `image_refresh_script()` reports a changed file — because the web view otherwise keeps showing the copy it already decoded for that URL until the process restarts. The handler resolves the path from the URL's segments alone, so the query is inert on the way in. `is_local_image_path()` is what tells the watcher an image changed rather than a document: the file bytes are unchanged, so the [live reload](../01-features/02-navigation.md#reload) would hash-gate itself out, and the images are refreshed in place instead.

## Bundled asset protocol

A second custom scheme, `leaf-asset://` (`http://leaf-asset.local/` where custom protocols are restricted), served by `bundled_asset_response()` in `assets.rs`, provides the renderer's vendored runtimes — the Mermaid bundle, the KaTeX script and stylesheet, the KaTeX WOFF2 fonts, the Monaco editor and stylesheet behind the [code view](../01-features/07-editing.md#editing-the-source), and the PixiJS + d3-force bundles behind the [Graph view](../01-features/03-library.md#graph) — straight from bytes compiled into the binary with `include_bytes!`. Diagrams, math, the source editor, and the graph therefore render fully offline, with no CDN dependency. The Content-Security-Policy restricts script sources to `'self'` plus this protocol; style and font sources also allow Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`), from which the active [theme](../01-features/06-themes.md#fonts) fetches its font. The graph and editor runtimes load lazily — only the first time their view opens — and a Pixi companion bundle swaps its `new Function` shader/uniform paths for eval-free polyfills so it runs under that CSP.

A third, `leaf-source://`, carries the [code view](../01-features/07-editing.md#code-view)'s payload: the exact buffer text, which is the whole of it now that the editor colors its own lines. It exists because `evaluate_script` is the wrong shape for megabytes: the whole script crosses the webview's process boundary, which measured over four seconds of a large file's entry, and `JSON.parse` in place of an object literal changed nothing, because the cost is the crossing rather than the parse. The host stages the payload, hands the page only a URL, and the renderer fetches it. The response carries `Access-Control-Allow-Origin` — the scheme is a different origin from the page, so without it the fetch is refused before the first byte — and `connect-src` names that origin, which is the only reason it appears in the Content-Security-Policy. One payload is held at a time: staging the next supersedes it, and a stale URL gets a 404 rather than old source.
