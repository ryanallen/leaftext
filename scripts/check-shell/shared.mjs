// The one doorway a front-end check imports. Nothing lives here: each name arrives from the one file whose job it is, and a subject reads all of them from this file rather than from any of those — otherwise a reader chasing one check is back in three files, and a value written from another file could not ride on the record at all.
//
// `scripts/check-shell.mjs` beside this folder is what runs the checks, in order.

// Failures, settled checks and the app stylesheet a check reads a rule out of.
export { check, checkSettled, createCollector, failures, layerOf, layersPainted, readingCss, settled } from './collector.mjs';

// The page's script assembled the way the binary assembles it, the top of the checkout, and the one record what crosses a file boundary by assignment rides on.
export { names, record, root, source } from './script.mjs';

// The fake page every check boots that script in.
export { detachChild, FakeElement, fakeElement, fakePage, matchingDescendants, pageMarkup, pageSnapshot, runShell, selectorParts, topLevelNames, VIEW_HEIGHT, VIEW_WIDTH, writeOnlyNames } from './page.mjs';

// The helpers and stands more than one subject reaches for.
export { bootReading, diagramStand, formatBarStand, homeStand, node, noopPost, registrationsOn, renderReadingDocument, settle, SHEET_FRAGMENTS, siteBoot, standInState, typingStand } from './stands.mjs';
