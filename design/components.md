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

| Component | Class family | Built by |
| --- | --- | --- |
| App bar | app-bar | `app-shell.html`, with `overflow.js` folding it and `code-view.js` measuring it |
| Tab strip | tab | `dom.js`, `render-state.js` |
| Overflow menu | app-actions | `app-shell.html`, driven by `overflow.js` |
| Icon button | icon-button | `app-shell.html` |
| Brand button | brand-button | `app-shell.html` |
| History button | history-button | `app-shell.html` |
| Open button | open-button | `app-shell.html` |
| New-document button | new-button | `app-shell.html` |
| Theme mode button | theme-mode-btn | `theme.js`, `app-shell.html` |
| Document button | leaf-md-button | `markdown/events.rs`, from `{[Label](url)}` in a document |
| Flowchart sheet | flow-sheet | `app-shell.html`, driven by `flow-canvas.js` |
| Theme sheet | theme-sheet | `app-shell.html`, driven by `theme.js` |
| Glossary sheet | glossary-sheet | `glossary.js` |
| Context menu | context-menu | `context-menu.js` |
| Breadcrumb menu | crumb-menu | `library.js` |
| Library pane | library | `library.js` |
| Search results | library-hit | `library-search.js` |
| Breadcrumbs | library-crumb | `library.js` |
| Minimap rail | document-minimap | `minimap.js` |
| Outline | document-outline | `decorate.js`, `reading-blocks.js` |
| Pager | docs-pager | `library.js`, `reading-blocks.js` |
| Block gutter | block-insert | `block-controls.js` |
| Selection toolbar | selection | `selection-toolbar.js` |
| Code view | code | `code-view.js` |
| Pinned headings | code-sticky | `code-sticky.js` |
| Copy button | code-copy | `decorate.js` |
| Graph | reader-graph | `app-shell.html`, drawn by `graph.js` and `graph-scene.js` |
| Flow canvas | flow | `flow-canvas.js` |
| Theme card | theme-item | `theme.js`, `lib.rs` |
| Theme setting row | setting-theme | `lib.rs` |
| Settings rows | settings | `settings.js`, `dom.js`, `updater.js`, `app-shell.html` |
| Link preview | link-hover | `glossary.js` |
| Document alerts | markdown-alert | `decorate.js`, `dom-to-markdown.js` |
| Syntax colors | syn | `markdown/code.rs`, whose `SYNTAX_STYLE_RULES` is the one table of these |
