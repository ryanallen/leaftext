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

| Component | Class family | Built by | Sample |
| --- | --- | --- | --- |
| App bar | app-bar | `app-shell.html`, with `overflow.js` folding it and `code-view.js` measuring it | `<div class="app-bar" style="position:static"><span class="app-bar-lead"><button type="button" class="brand-button"><span class="lt-icon lt-icon-leaf"></span></button></span></div>` |
| Tab strip | tab | `dom.js`, `render-state.js` | `<div class="tab-bar"><button type="button" class="tab is-active"><span class="tab-label">Active tab</span><span class="tab-close"><span class="lt-icon lt-icon-close"></span></span></button><button type="button" class="tab"><span class="tab-label">Another</span></button></div>` |
| Overflow menu | app-actions | `app-shell.html`, driven by `overflow.js` | `<div class="app-actions"><button type="button" class="icon-button open-button"><span class="lt-icon lt-icon-open"></span></button></div>` |
| Icon button | icon-button | `app-shell.html` | `<button type="button" class="icon-button"><span class="lt-icon lt-icon-settings"></span></button>` |
| Brand button | brand-button | `app-shell.html` | `<button type="button" class="brand-button"><span class="lt-icon lt-icon-leaf"></span></button>` |
| History button | history-button | `app-shell.html` | `<button type="button" class="icon-button history-button"><span class="lt-icon lt-icon-back"></span></button> <button type="button" class="icon-button history-button" disabled><span class="lt-icon lt-icon-forward"></span></button>` |
| Open button | open-button | `app-shell.html` | `<button type="button" class="icon-button open-button"><span class="lt-icon lt-icon-open"></span></button>` |
| New-document button | new-button | `app-shell.html` | `<button type="button" class="icon-button new-button"><span class="lt-icon lt-icon-new"></span></button>` |
| Theme mode button | theme-mode-btn | `theme.js`, `app-shell.html` | `<button type="button" class="theme-mode-btn is-active">Light</button> <button type="button" class="theme-mode-btn">Dark</button>` |
| Document button | leaf-md-button | `markdown/events.rs`, from `{[Label](url)}` in a document | `<div class="document-body"><a class="leaf-md-button" href="#">Primary</a> <a class="leaf-md-button leaf-md-button--secondary" href="#">Secondary</a></div>` |
| Flowchart sheet | flow-sheet | `app-shell.html`, driven by `flow-canvas.js` | `<div class="leaf-sheet flow-sheet open" style="position:static"><div class="leaf-sheet-grip"></div><div class="flow-sheet-head">Flowchart</div></div>` |
| Theme sheet | theme-sheet | `app-shell.html`, driven by `theme.js` | `<div class="leaf-sheet theme-sheet open" style="position:static"><div class="leaf-sheet-grip"></div><ul class="theme-sheet-grid"><li><button type="button" class="theme-item"><span class="theme-item-name">Fern</span></button></li></ul></div>` |
| Glossary sheet | glossary-sheet | `glossary.js` | `<div class="leaf-sheet glossary-sheet open" style="position:static"><div class="leaf-sheet-grip"></div><div class="glossary-sheet-title">A term</div></div>` |
| Context menu | context-menu | `context-menu.js` | `<div class="context-menu" style="position:static"><button type="button" class="context-menu-item">Open</button><button type="button" class="context-menu-item is-danger">Delete</button></div>` |
| Breadcrumb menu | crumb-menu | `library.js` | `<div class="context-menu crumb-menu" style="position:static"><button type="button" class="context-menu-item crumb-menu-item">A folder</button></div>` |
| Library pane | library | `library.js` | `<div class="library-pane" style="position:static"><div class="library-tree"><button type="button" class="library-file is-selected"><span class="lt-icon lt-icon-leaf"></span><span class="library-file-label">A note.md</span></button><button type="button" class="library-nav-folder"><span class="lt-icon lt-icon-folder"></span><span class="library-file-label">A folder</span></button></div></div>` |
| Search results | library-hit | `library-search.js` | `<button type="button" class="library-hit"><span class="library-hit-title">A note</span><span class="library-hit-snippet">the matched words</span></button>` |
| Breadcrumbs | library-crumb | `library.js` | `<div class="library-crumb-trail"><button type="button" class="library-crumb">Vault</button><button type="button" class="library-crumb">Folder</button></div>` |
| Minimap rail | document-minimap | `minimap.js` | `<aside class="document-minimap" style="height:120px"><div class="document-minimap-track"><div class="document-minimap-viewport"></div></div></aside>` |
| Outline | document-outline | `decorate.js`, `reading-blocks.js` | `<div class="document-outline"><div class="document-outline-title">On this page</div><a class="document-outline-link" href="#">A heading</a></div>` |
| Pager | docs-pager | `library.js`, `reading-blocks.js` | `<nav class="docs-pager"><a class="docs-pager-link" href="#">Previous</a><a class="docs-pager-link" href="#">Next</a></nav>` |
| Block gutter | block-insert | `block-controls.js` | `<div class="block-insert-row"><button type="button" class="block-insert" title="Paragraph"><span class="lt-icon lt-icon-text"></span></button><button type="button" class="block-insert" title="Heading"><span class="lt-icon lt-icon-heading"></span></button></div>` |
| Selection toolbar | selection | `selection-toolbar.js` | `<div class="selection-toolbar" style="position:static"><div class="selection-format-row"><button type="button" class="selection-format"><span class="lt-icon lt-icon-bold"></span></button><button type="button" class="selection-format"><span class="lt-icon lt-icon-italic"></span></button></div></div>` |
| Code view | code | `code-view.js` | `<div class="code-frame"><div class="code-toolbar"><button type="button" class="code-copy">Copy</button></div></div>` |
| Pinned headings | code-sticky | `code-sticky.js` | `<div class="code-sticky"><div class="code-sticky-row">A pinned heading</div></div>` |
| Copy button | code-copy | `decorate.js` | `<button type="button" class="code-copy">Copy</button>` |
| Graph | reader-graph | `app-shell.html`, drawn by `graph.js` and `graph-scene.js` | `<div class="reader-graph" style="height:80px"><div class="graph-key"><span class="graph-key-document">Document</span><span class="graph-key-external">Link out</span></div></div>` |
| Flow canvas | flow | `flow-canvas.js` | `<div class="flow-stage" style="height:80px"><div class="flow-steps"><button type="button" class="flow-step"><span class="lt-icon lt-icon-workflow"></span></button></div></div>` |
| Theme card | theme-item | `theme.js`, `lib.rs` | `<ul class="theme-sheet-grid"><li><button type="button" class="theme-item" aria-pressed="true"><span class="theme-item-name">Fern</span></button></li></ul>` |
| Theme setting row | setting-theme | `lib.rs` | `<button type="button" class="setting-theme-open"><span class="setting-label">Theme</span><span class="setting-theme-current">Fern</span><span class="setting-theme-chevron">&rsaquo;</span></button>` |
| Settings rows | settings | `settings.js`, `dom.js`, `updater.js`, `app-shell.html` | `<div class="settings-panel"><label class="setting-control"><span class="setting-label">A setting</span><input type="checkbox" checked></label></div>` |
| Link preview | link-hover | `glossary.js` | `<div class="link-hover-card" style="position:static"><div class="link-hover-title">A linked note</div><div class="link-hover-body">Its opening line.</div></div>` |
| Document alerts | markdown-alert | `decorate.js`, `dom-to-markdown.js` | `<div class="document-body"><div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title">Note</p><p>Something worth knowing.</p></div></div>` |
| Bottom sheet | leaf-sheet | `app-shell.html`, driven by `flow-canvas.js`, `theme.js` and `glossary.js` | `<div class="leaf-sheet open" style="position:static"><div class="leaf-sheet-grip"></div><button type="button" class="leaf-sheet-close"><span class="lt-icon lt-icon-close"></span></button></div>` |
| Sheet scrim | lt-backdrop | `app-shell.html` | `<div class="lt-backdrop open" style="position:static;height:48px"></div>` |
| Spinner | lt-spinner | `app-shell.html`, `glossary.js`, `minimap.js`, `lib.rs` | `<span class="lt-spinner settings-spinner"></span> <span class="lt-spinner glossary-sheet-spinner"></span>` |
| Icon | lt-icon | everything, drawn by `icons.css` | `<span class="lt-icon lt-icon-leaf"></span> <span class="lt-icon lt-icon-graph"></span> <span class="lt-icon lt-icon-wand"></span>` |
| Scroll area | leaf-scroll | `app-shell.html` | `<div class="leaf-scroll" style="height:64px;overflow:auto"><div style="height:200px"></div></div>` |
| Toast | app-toast | `dom.js` | `<div class="app-toast">Saved</div>` |
| Reader tool bar | reader-tool | `app-shell.html` | `<div class="reader-toolbar"><button type="button" class="reader-tool is-active"><span class="lt-icon lt-icon-document"></span></button><button type="button" class="reader-tool"><span class="lt-icon lt-icon-code-view"></span></button><button type="button" class="reader-tool"><span class="lt-icon lt-icon-graph"></span></button></div>` |
| Window controls | window-control | `app-shell.html` | `<div class="window-controls"><button type="button" class="window-control">&minus;</button><button type="button" class="window-control window-control-close">&times;</button></div>` |
| Empty state | empty-state | `render-document.js` | `<div class="empty-state"><div class="empty-subtitle">Nothing open</div><div class="empty-description">Open a document to start.</div></div>` |
| Syntax colors | syn | `markdown/code.rs`, whose `SYNTAX_STYLE_RULES` is the one table of these | `<div class="document-body"><pre><code><span class="syn-keyword">fn</span> <span class="syn-function">main</span>() { <span class="syn-comment">// a comment</span> <span class="syn-string">"text"</span> }</code></pre></div>` |
