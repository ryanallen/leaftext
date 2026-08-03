# Components

> One row per component: the class family that styles it, and what builds it.

`just check-tokens` reads this file and fails when a row names a class family
`src/assets/reading.css` does not style, so a renamed or deleted component cannot sit
here looking real. The other half of the rule — every family having a row, and every
row having a gallery section — arrives with `gallery.html`.

**Class families, not classes.** A family is the prefix a component's classes share:
`library` covers `library-tree`, `library-file`, `library-row.is-selected` and dozens
more. No rule count here: it would go stale on the next edit to the stylesheet, and
what matters is that something styles the family at all.

| Component | Class family | Built by | Sample | Also owns |
| --- | --- | --- | --- | --- |
| App bar | app-bar | `app-shell.html`, with `overflow.js` folding it and `code-view.js` measuring it | `<div class="app-bar" style="position:static"><span class="app-bar-lead"><button type="button" class="brand-button"><span class="lt-icon lt-icon-leaf"></span></button></span></div>` | app-trailing app-overflow history-actions |
| Tab strip | tab | `dom.js`, `render-state.js` | `<div class="tab-bar"><span class="tab tab-active"><button type="button" class="tab-label">A note.md</button><span class="tab-dirty-dot"></span><button type="button" class="tab-close"><span class="lt-icon lt-icon-tab-close"></span></button></span><span class="tab"><button type="button" class="tab-label">Another note.md</button></span></div>` | — |
| Overflow menu | app-actions | `app-shell.html`, driven by `overflow.js` | `<div class="app-actions"><button type="button" class="icon-button open-button"><span class="lt-icon lt-icon-open"></span></button></div>` | overflow-toggle overflow-open |
| Icon button | icon-button | `app-shell.html` | `<button type="button" class="icon-button history-button"><span class="lt-icon lt-icon-back"></span></button>` | — |
| Brand button | brand-button | `app-shell.html` | `<button type="button" class="brand-button"><span class="lt-icon lt-icon-leaf"></span></button>` | — |
| History button | history-button | `app-shell.html` | `<button type="button" class="icon-button history-button"><span class="lt-icon lt-icon-back"></span></button> <button type="button" class="icon-button history-button" disabled><span class="lt-icon lt-icon-forward"></span></button>` | — |
| Theme button | theme-button | `app-shell.html` | `<button type="button" class="icon-button theme-button"><span class="lt-icon lt-icon-theme"></span></button>` | — |
| Open button | open-button | `app-shell.html` | `<button type="button" class="icon-button open-button"><span class="lt-icon lt-icon-open"></span></button>` | — |
| New-document button | new-button | `app-shell.html` | `<button type="button" class="icon-button new-button"><span class="lt-icon lt-icon-new"></span></button>` | — |
| Theme mode button | theme-mode-btn | `theme.js`, `app-shell.html` | `<button type="button" class="theme-mode-btn is-active">Light</button> <button type="button" class="theme-mode-btn">Dark</button>` | — |
| Document button | leaf-md-button | `markdown/events.rs`, from `{[Label](url)}` in a document | `<div class="document-body"><a class="leaf-md-button" href="#">Primary</a> <a class="leaf-md-button leaf-md-button--secondary" href="#">Secondary</a></div>` | — |
| Flowchart sheet | flow-sheet | `app-shell.html`, driven by `flow-canvas.js` | `<div class="leaf-sheet flow-sheet open" style="position:static"><div class="leaf-sheet-grip"></div><div class="flow-sheet-head"><span class="flow-sheet-title">Flowchart</span><div class="flow-sheet-tools"><div class="flow-zoom"><button type="button"><span class="lt-icon lt-icon-zoom-out"></span></button><button type="button"><span class="lt-icon lt-icon-fit"></span></button><button type="button"><span class="lt-icon lt-icon-zoom-in"></span></button></div></div><div class="flow-sheet-actions"><button type="button" class="flow-sheet-cancel">Cancel</button><button type="button" class="flow-sheet-save">Save</button></div></div><div class="flow-sheet-panes"><section class="flow-pane flow-pane-canvas"><div class="flow-canvas" style="height:72px"></div></section></div></div>` | — |
| Theme sheet | theme-sheet | `app-shell.html`, driven by `theme.js` | `<div class="leaf-sheet theme-sheet open" style="position:static"><div class="leaf-sheet-grip"></div><div class="theme-sheet-head"><span class="theme-sheet-title">Themes</span></div><ul class="theme-sheet-grid"><li><button type="button" class="theme-item" aria-pressed="true"><span class="theme-item-name">Fern</span><span class="theme-swatches" aria-hidden="true"><span class="theme-swatch" style="--sw-light:var(--lt-primary);--sw-dark:var(--lt-primary)"></span><span class="theme-swatch" style="--sw-light:var(--lt-surface);--sw-dark:var(--lt-surface)"></span><span class="theme-swatch" style="--sw-light:var(--lt-background);--sw-dark:var(--lt-background)"></span></span></button></li></ul></div>` | — |
| Glossary sheet | glossary-sheet | `glossary.js` | `<div class="leaf-sheet glossary-sheet open" style="position:static"><div class="leaf-sheet-grip"></div><div class="glossary-sheet-title">A term</div><div class="glossary-sheet-body"><p>What the term means, read out of the vault's glossary.</p></div></div>` | — |
| Context menu | context-menu | `context-menu.js` | `<div class="context-menu" style="position:static"><button type="button" class="context-menu-item">Open</button><button type="button" class="context-menu-item is-danger">Delete</button></div>` | rename-box rename-input |
| Breadcrumb menu | crumb-menu | `library.js` | `<div class="context-menu crumb-menu" style="position:static"><button type="button" class="context-menu-item crumb-menu-item">A folder</button></div>` | — |
| Library pane | library | `library.js` | `<div class="library-pane" style="position:static;width:240px;height:132px"><div class="library-tree"><button type="button" class="library-file is-selected"><span class="lt-icon lt-icon-leaf"></span><span class="library-file-label">A note.md</span></button><button type="button" class="library-nav-folder"><span class="lt-icon lt-icon-folder"></span><span class="library-file-label">A folder</span></button></div></div>` | — |
| Search results | library-hit | `library-search.js` | `<button type="button" class="library-hit"><span class="library-hit-title">A note<span class="library-hit-alias">Its other name</span></span><span class="library-hit-snippet">the matched words</span></button>` | — |
| Breadcrumbs | library-crumb | `library.js` | `<div class="library-crumb-trail"><button type="button" class="library-crumb">Vault</button><button type="button" class="library-crumb">Folder</button></div>` | — |
| Minimap rail | document-minimap | `minimap.js` | `<aside class="document-minimap" style="height:120px"><div class="document-minimap-track"><div class="document-minimap-viewport"></div></div></aside>` | minimap-slider reader-minimap |
| Outline | document-outline | `decorate.js`, `reading-blocks.js` | `<div class="document-body"><div class="document-outline"><div class="document-outline-title">On this page</div><a class="document-outline-link" href="#">A heading</a></div></div>` | — |
| Pager | docs-pager | `library.js`, `reading-blocks.js` | `<nav class="docs-pager"><a class="docs-pager-link" href="#">Previous</a><a class="docs-pager-link" href="#">Next</a></nav>` | — |
| Block gutter | block-insert | `block-controls.js` | `<div class="block-insert-row"><button type="button" class="block-insert" title="Paragraph"><span class="lt-icon lt-icon-text"></span></button><button type="button" class="block-insert" title="Heading"><span class="lt-icon lt-icon-heading"></span></button></div>` | block-gutter block-add block-drag block-grip block-gap |
| Selection toolbar | selection | `selection-toolbar.js` | `<div class="selection-toolbar" style="position:static"><div class="selection-format-row"><button type="button" class="selection-format"><span class="lt-icon lt-icon-bold"></span></button><button type="button" class="selection-format"><span class="lt-icon lt-icon-italic"></span></button></div></div>` | — |
| Find bar | find | `app-shell.html`, driven by `find-bar.js` | `<div class="find-bar" style="position:static"><div class="find-row"><span class="find-field"><input class="find-input" type="text" placeholder="Find" value="dharma"><span class="find-count">3 of 41</span></span><span class="find-flags"><button type="button" class="find-flag" aria-pressed="true">Aa</button><button type="button" class="find-flag">ab&#124;</button><button type="button" class="find-flag">.*</button></span><button type="button" class="find-step"><span class="lt-icon lt-icon-chevron-down find-step-back"></span></button><button type="button" class="find-step"><span class="lt-icon lt-icon-chevron-down"></span></button><button type="button" class="find-step" aria-pressed="true"><span class="lt-icon lt-icon-replace"></span></button><button type="button" class="find-step"><span class="lt-icon lt-icon-close"></span></button></div><div class="find-row"><span class="find-field"><input class="find-input" type="text" placeholder="Replace with"></span><button type="button" class="find-action">Replace</button><button type="button" class="find-action">All</button></div></div>` | leaf-find-match leaf-find-current |
| Code view | code | `code-view.js` | `<div class="code-frame"><div class="code-toolbar"><button type="button" class="code-copy">Copy</button></div></div>` | monaco-editor margin-view-overlays line-numbers |
| Pinned headings | code-sticky | `code-sticky.js` | `<div class="code-sticky"><div class="code-sticky-row">A pinned heading</div></div>` | — |
| Copy button | code-copy | `decorate.js` | `<button type="button" class="code-copy">Copy</button>` | — |
| Graph | reader-graph | `app-shell.html`, drawn by `graph.js` and `graph-scene.js` | `<div class="reader-graph" style="height:120px"><p class="reader-graph-legend"><span class="graph-key graph-key-document"></span>your documents<span class="graph-key graph-key-external"></span>web addresses</p></div>` | graph-key |
| Flow canvas | flow | `flow-canvas.js` | `<div class="flow-canvas" style="height:88px"><p class="flow-hint">Double-click to add a box</p></div>` | — |
| Theme card | theme-item | `theme.js`, `lib.rs` | `<ul class="theme-sheet-grid" style="max-width:320px"><li><button type="button" class="theme-item" aria-pressed="true"><span class="theme-item-name">Fern</span><span class="theme-swatches" aria-hidden="true"><span class="theme-swatch" style="--sw-light:var(--lt-primary);--sw-dark:var(--lt-primary)"></span><span class="theme-swatch" style="--sw-light:var(--lt-accent);--sw-dark:var(--lt-accent)"></span><span class="theme-swatch" style="--sw-light:var(--lt-markdown-background);--sw-dark:var(--lt-markdown-background)"></span></span></button></li></ul>` | theme-swatch theme-swatches |
| Update bell | update | `updater.js`, `app-shell.html` | `<details class="update-menu" open style="position:static"><summary class="icon-button"><span class="lt-icon lt-icon-update"></span><span class="update-alert-dot"></span></summary><div class="update-panel" style="position:static;margin-top:8px"><button type="button" class="update-button"><span class="update-button-label">Restart to update</span></button></div></details>` | — |
| Link preview | link-hover | `glossary.js` | `<div class="link-hover-tip" style="position:static"><div class="link-hover-tip-kind">Note</div><div class="link-hover-tip-detail">A linked note — its opening line.</div></div>` | — |
| Document alerts | markdown-alert | `decorate.js`, `dom-to-markdown.js` | `<div class="document-body"><blockquote class="markdown-alert markdown-alert-note"><p>Something worth knowing. The word above it is drawn by the stylesheet, not written in the document.</p></blockquote></div>` | — |
| Bottom sheet | leaf-sheet | `app-shell.html`, driven by `flow-canvas.js`, `theme.js` and `glossary.js` | `<div class="leaf-sheet open" style="position:static"><div class="leaf-sheet-grip"></div><button type="button" class="leaf-sheet-close" style="align-self:flex-end"><span class="lt-icon lt-icon-close"></span></button><p style="padding:0 20px 20px">Whatever the sheet is for goes here: a theme picker, a glossary entry, a flowchart.</p></div>` | — |
| Sheet scrim | lt-backdrop | `app-shell.html` | `<div class="lt-backdrop open" style="position:static;height:48px"></div>` | — |
| Spinner | lt-spinner | `app-shell.html`, `glossary.js`, `minimap.js`, `lib.rs` | `<div class="reader-loading" style="position:static"><div class="lt-spinner reader-loading-spinner"></div></div><div class="glossary-sheet-waiting"><div class="lt-spinner glossary-sheet-spinner"></div></div>` | — |
| Icon | lt-icon | everything, drawn by `icons.css` | `<a class="jump" href="#icons"><span class="lt-icon lt-icon-leaf"></span>All 54 icons, on the Icons tab</a>` | — |
| Scroll area | leaf-scroll | `app-shell.html` | `<div class="leaf-scroll" style="height:64px;overflow:auto"><p>This box scrolls, and the bar it draws is the app’s own.</p><div style="height:120px"></div></div>` | — |
| Toast | app-toast | `dom.js` | `<div class="app-toast is-shown">Saved</div>` | — |
| Reader tool bar | reader-tool | `app-shell.html` | `<div class="reader-toolbar"><span class="reader-view-tools"><label class="reader-subselect"><span class="reader-subselect-label">Graph size</span><select><option>Focus</option></select></label></span><button type="button" class="reader-tool is-active"><span class="lt-icon lt-icon-document"></span></button><button type="button" class="reader-tool"><span class="lt-icon lt-icon-code-view"></span></button><button type="button" class="reader-tool"><span class="lt-icon lt-icon-graph"></span></button></div>` | reader-toolbar reader-view-tools reader-subtool reader-subselect reader-glyph-on reader-glyph-off reader-swap-glyph undo-button |
| Window controls | window-control | `app-shell.html` | `<div class="window-controls"><button type="button" class="window-control"><span class="lt-icon lt-icon-window-minimize"></span></button><button type="button" class="window-control"><span class="lt-icon wc-maximize lt-icon-window-maximize"></span></button><button type="button" class="window-control window-control-close"><span class="lt-icon lt-icon-window-close"></span></button></div>` | window-controls wc-maximize wc-restore |
| Empty state | empty-state | `render-document.js` | `<div class="empty-state" style="padding:8px 0"><div class="empty-subtitle">Nothing open</div><div class="empty-description">Open a document to start.</div></div>` | empty-actions empty-description empty-help empty-subtitle empty-version primary-new primary-open kicker recent |
| Reader frame | reader-shell | `app-shell.html` | `<div class="reader-shell" style="height:96px"><div class="reader-corner reader-corner-tl"></div><p style="padding:12px">The page sits in here.</p></div>` | reader-layout reader-corner reader-edge-fade reader-loading |
| Diagram controls | mermaid-tool | `decorate.js` | `<div class="mermaid-tools" style="opacity:1"><button type="button" class="mermaid-tool"><span class="lt-icon lt-icon-fit"></span></button></div><div class="mermaid-zoom" style="opacity:1"><button type="button"><span class="lt-icon lt-icon-zoom-out"></span></button><button type="button"><span class="lt-icon lt-icon-zoom-in"></span></button></div>` | mermaid-tools mermaid-zoom |
| Syntax colors | syn | `markdown/code.rs`, whose `SYNTAX_STYLE_RULES` is the one table of these | `<div class="document-body"><pre><code><span class="syn-keyword">fn</span> <span class="syn-function">main</span>() { <span class="syn-comment">// a comment</span> <span class="syn-string">"text"</span> }</code></pre></div>` | — |

## What a document brings

The renderer writes these into a rendered page. They are not parts of the app's own
interface — there is no state to show and nothing to put in the gallery — so a prefix
here is all the accounting they need.

| Prefix | What it is |
| --- | --- |
| document-body | The page a document is rendered into, and everything the renderer styles inside it. |
| frontmatter | A document's own metadata table. |
| footnote | Footnote references, definitions and the arrow back up. |
| math | Inline and display math, from KaTeX. |
| mermaid | A diagram fence, before and after it is drawn. |
| github | An issue reference, a pull request, a mention. |
| glossary-term | A word the glossary links. |
| emoji | A `:shortcode:` turned into an image. |
| highlight | A search hit inside a document. |
| caption | A figure's caption. |
| metadata | A TEI or email header block. |
| cluster | A group in a drawn diagram. |
| blockquote-line | The bar down the side of a quote. |
| blockquote-lines | The box those bars are drawn in. |
| data-table | A JSON or YAML tree, rendered. |
| data-fields | Its key rows. |
| data-attributes | An XML element's attributes. |
| data-value-attrs | A value that carries attributes of its own. |
| tei-front | A TEI document's front matter. |
| tei-doc | Its title and subtitles. |
| leaf-editable | A block the reading view can be typed into. |
| leaf-editing-source | The block being edited, while it is. |
| leaf-insert-block | A block the gutter just made. |
| speed-reader-anchor | Where the speed reader is up to. |
| syn | A syntax color. One per role, mirrored by `SYNTAX_STYLE_RULES`. |

## State and environment

A flag on something already listed, rather than a thing of its own. Anything starting
`is-`, `has-` or `no-` is a state without being listed; these are the ones that are
not spelled that way.

| Name | What it says |
| --- | --- |
| open | A sheet, menu or panel is showing. |
| frameless | The window draws its own title bar, so the app bar is it. |
| font-ready | The theme's font has loaded, so text can stop hiding. |
| tabs-settling | The tab strip is mid-animation and must not be measured. |
