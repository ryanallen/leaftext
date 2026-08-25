// Run the WebView front-end: does it parse, does it boot, and is the code view's edit arithmetic right (it decides what gets written to a file).
//
// Nothing else runs this script before a user does, and a fragment that throws as it loads opens a blank window. One subject per file in `check-shell/`; this is the order they run in, and the boot is first because it fills the record the rest read.

import { failures, names, record, settled } from './check-shell/shared.mjs';
import { run as runParsesAndBoots } from './check-shell/parses-and-boots.mjs';
import { run as runTheFolderAndTheList } from './check-shell/the-folder-and-the-list.mjs';
import { run as runBlockRanges } from './check-shell/block-ranges.mjs';
import { run as runLinksAndPreviews } from './check-shell/links-and-previews.mjs';
import { run as runReaderToolbar } from './check-shell/reader-toolbar.mjs';
import { run as runFormatBar } from './check-shell/format-bar.mjs';
import { run as runUndoAndRedo } from './check-shell/undo-and-redo.mjs';
import { run as runOtherFormats } from './check-shell/other-formats.mjs';
import { run as runThePlusAndTheGutter } from './check-shell/the-plus-and-the-gutter.mjs';
import { run as runABlockThatRefuses } from './check-shell/a-block-that-refuses.mjs';
import { run as runFindBar } from './check-shell/find-bar.mjs';
import { run as runCodeViewGrammar } from './check-shell/code-view-grammar.mjs';
import { run as runDiagramSheet } from './check-shell/diagram-sheet.mjs';
import { run as runDrawingADiagram } from './check-shell/drawing-a-diagram.mjs';
import { run as runDiagramExport } from './check-shell/diagram-export.mjs';
import { run as runDiagramFullWindow } from './check-shell/diagram-full-window.mjs';
import { run as runTableLane } from './check-shell/table-lane.mjs';
import { run as runPicturesInTheLane } from './check-shell/pictures-in-the-lane.mjs';
import { run as runMapAndRail } from './check-shell/map-and-rail.mjs';
import { run as runLibraryPaneWidth } from './check-shell/library-pane-width.mjs';
import { run as runCopyingHighlightedText } from './check-shell/copying-highlighted-text.mjs';
import { run as runRightClickMenu } from './check-shell/right-click-menu.mjs';
import { run as runFirstRunBubble } from './check-shell/first-run-bubble.mjs';
import { run as runTheBarFolds } from './check-shell/the-bar-folds.mjs';
import { run as runExportingThePage } from './check-shell/exporting-the-page.mjs';
import { run as runAPublishedSite } from './check-shell/a-published-site.mjs';
import { run as runTheReadingRender } from './check-shell/the-reading-render.mjs';
import { run as runReadingUnderTheMap } from './check-shell/reading-under-the-map.mjs';
import { run as runFilenamesAndTabs } from './check-shell/filenames-and-tabs.mjs';
import { run as runVaultsAndRecent } from './check-shell/vaults-and-recent.mjs';
import { run as runTheStartScreen } from './check-shell/the-start-screen.mjs';
import { run as runScrollEdgesAndBars } from './check-shell/scroll-edges-and-bars.mjs';
import { run as runFavorites } from './check-shell/favorites.mjs';
import { run as runLibraryRows } from './check-shell/library-rows.mjs';
import { run as runWhatAVaultIs } from './check-shell/what-a-vault-is.mjs';
import { run as runThePagesOwnErrors } from './check-shell/the-pages-own-errors.mjs';
import { run as runBrowserHost } from './check-shell/browser-host.mjs';
import { run as runEmbedHost } from './check-shell/embed-host.mjs';
import { run as runTheAppsOwnBox } from './check-shell/the-apps-own-box.mjs';
import { run as runTheShadowBand } from './check-shell/the-shadow-band.mjs';
import { run as runTheFocusRing } from './check-shell/the-focus-ring.mjs';

// Every subject, in the order it was written in. The boot comes first: it fills the record the rest read.

runParsesAndBoots();
runTheFolderAndTheList();
runBlockRanges();
runLinksAndPreviews();
runReaderToolbar();
runFormatBar();
runUndoAndRedo();
runOtherFormats();
runThePlusAndTheGutter();
runABlockThatRefuses();
runFindBar();
runCodeViewGrammar();
runDiagramSheet();
runDrawingADiagram();
runDiagramExport();
runDiagramFullWindow();
runTableLane();
runPicturesInTheLane();
runMapAndRail();
runLibraryPaneWidth();
runCopyingHighlightedText();
runRightClickMenu();
runFirstRunBubble();
runTheBarFolds();
runExportingThePage();
runAPublishedSite();
runTheReadingRender();
runReadingUnderTheMap();
runFilenamesAndTabs();
runVaultsAndRecent();
runTheStartScreen();
runScrollEdgesAndBars();
runFavorites();
runLibraryRows();
runWhatAVaultIs();
runThePagesOwnErrors();
runBrowserHost();
runEmbedHost();
runTheAppsOwnBox();
runTheShadowBand();
runTheFocusRing();

// ---- report -----------------------------------------------------------------

await Promise.all(settled);

if (failures.length) {
  console.error('front-end check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`front-end: ${names.length} fragments parse, boot, and agree on edit offsets — and the two browser hosts answer ${record.webAnswered} commands for a published site and ${record.embedAnswered} for an embedded document, each over a stand-in module`);
