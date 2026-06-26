---
glossary: GLOSSARY.md
---

# Glossary

One shared glossary for the docs. Link into it with an ordinary Markdown link
to this file plus the term's anchor, for example
`[minimap](GLOSSARY.md#minimap)` from a page in this folder, or
`[minimap](../GLOSSARY.md#minimap)` from a page one level down. Clicking the
link opens the entry in a bottom sheet over the page you are reading; it does
not navigate away.

## Minimap

The slim overview rail down the right edge of the reading view. It maps the
whole document to a single column so you can see structure at a glance and jump
by clicking.

## Frontmatter

Metadata at the top of a Markdown file inside a leading `--- ... ---` block.
Leaf reads it but does not show it in the rendered document.

## Bottom Sheet

A panel that slides up from the bottom of the reading view to show a glossary
entry without taking you away from the current document. Dismiss it with its
close button, by clicking outside it, or with the Escape key.

## Slug

The anchor id made from a heading: `Bottom Sheet` becomes `#bottom-sheet`.
Glossary links target these slugs.

## Tab

One open document in Leaf. Each tab keeps its own Back/Forward history and
remembers where you had scrolled to.
