//! The exported page and the theme it is written in.

use super::*;

/// The theme survives being printed. A print render emulates a light color scheme, and the bootstrap follows the system scheme whenever the mode is `system` — so the listener fired mid-print and repainted the whole app in the light family for exactly as long as the picture was being taken, which is how a dark theme came out on white paper in dark ink. The hold is what stops it, and it is read here because the bootstrap is an inline script the front-end check never boots.
#[test]
fn the_theme_is_held_while_a_page_is_being_rendered_for_paper() {
    let boot = include_str!("../assets/theme-bootstrap.js");

    // The guard itself, on the one listener that can change the appearance without anybody asking.
    assert_contains(boot, "mode === 'system' && !holdingAppearance");

    // A browser's own print says when it starts and stops. The desktop renders the page without the page hearing about it at all, so the host holds around the render — which is why it is a count rather than a flag.
    assert_contains(boot, "window.addEventListener('beforeprint'");
    assert_contains(boot, "window.addEventListener('afterprint'");
    assert_contains(boot, "Math.max(0, holdingAppearance + (held ? 1 : -1))");

    // Measuring holds briefly, and each native render releases the hold it raised.
    assert_contains(
        include_str!("../assets/shell/overflow.js"),
        "window.leafHoldAppearance(true)",
    );
    // Held as source because this is the library's own test tree, which cannot name a module of the binary at all.
    let export = include_str!("../app/fileops.rs");
    assert_contains(
        export,
        "window.leafHoldAppearance && window.leafHoldAppearance(false);",
    );
    assert!(
        export.matches("release(page)").count() == 2,
        "only the PDF and picture renders have a hold to release"
    );
}

/// The page an export writes: the document as the page drew it, in the theme it was drawn in, naming the one stylesheet in the folder beside it.
///
/// Nothing is fetched. A theme is two attributes on the root and every theme's colors are in that one stylesheet, so the page opens in the right theme before its one script has even loaded. The drawings' own stylesheet is the exception that has to travel: mermaid writes one per drawing and the page hoists them into a single element in its head, so it is neither in the stylesheet nor inside the SVG — watched in a real browser, a page written without it is a page of black boxes with clipped labels.
#[test]
fn an_exported_page_names_its_stylesheet_and_pins_the_theme_it_was_written_in() {
    let page = exported_page_document(
        "moss",
        "dark",
        "Release notes",
        ".lt-mmd-0 .node rect { fill: #123; }",
        "<div class=\"app-surface\">the document</div>",
    );

    assert_contains(&page, "<!DOCTYPE html>");
    assert_contains(&page, "data-leaf-theme=\"moss\"");
    assert_contains(&page, "data-leaf-appearance=\"dark\"");
    assert_contains(&page, "<title>Release notes</title>");
    // The folder the pictures go in is the same one, so the two are named together and nowhere else. The sheet is named after the drawings this page's theme wears, because the folder is shared and a second page may wear another set.
    assert_eq!(exported_page_stylesheet("moss"), "assets/app-leaftext.css");
    assert_contains(
        &page,
        "<link rel=\"stylesheet\" href=\"assets/app-leaftext.css\">",
    );
    // `leaf-paper` drops the app's own frame off the sheet and makes the browser scroll the body rather than the page carrying a scroller of its own; `leaf-web` hands a wide table or picture back its screen width, which the paper rules alone freeze at the text measure, and it is what the rail's placement rules are keyed on. The whole attribute, not a substring: nothing on this page ever writes a class, so these two are the page's entire state for ever.
    assert_contains(&page, "<body class=\"leaf-paper leaf-web\">");
    assert_contains(&page, "<div class=\"app-surface\">the document</div>");

    // Inline, as the one element the page already holds it as: a second file in the folder would buy a fetch and another name for nothing.
    assert_contains(&page, "<style id=\"leaf-mermaid-sheets\">");
    assert_contains(&page, ".lt-mmd-0 .node rect { fill: #123; }");

    // A document with no drawing in it carries no empty element for one.
    let plain = exported_page_document("dusk", "light", "", "", "<p>hello</p>");
    assert!(
        !plain.contains("leaf-mermaid-sheets"),
        "a document with no drawing carried a stylesheet for one: {plain}"
    );
    assert_contains(&plain, "<title>Document</title>");

    // The three values the page hands over are a theme name, an appearance and somebody's document title, and a title is whatever they called their file.
    let named = exported_page_document("moss", "dark", "Q1 \"final\" <notes>", "", "");
    assert_contains(&named, "<title>Q1 &quot;final&quot; &lt;notes&gt;</title>");
}

/// The one script an exported page runs: the minimap rail, named off the folder beside the page and spelled so a browser will load it from a disk.
///
/// Two things, and they fail apart. The page has to name the file with `defer`, so the script runs once the document it clones is parsed. And the file itself has to be a plain script: the copy both published sites run is a module, and a browser refuses a module script on a page opened off a disk — watched, as a rail that never appeared at all. So the `export` mark comes off and the call the sites make from their own code goes on the foot instead.
#[test]
fn an_exported_page_carries_the_minimap_as_a_plain_script_it_calls_itself() {
    let page = exported_page_document("moss", "dark", "Notes", "", "<p>hello</p>");
    assert_eq!(EXPORTED_PAGE_MINIMAP_SCRIPT, "assets/minimap.js");
    // Deferred: the rail clones the drawn document, so it must not run before the document is parsed.
    assert_contains(&page, "<script src=\"assets/minimap.js\" defer></script>");

    let script = exported_page_minimap_script();
    // The arithmetic is the sites' own, taken from the one copy in the tree rather than written again here.
    assert_contains(&script, "function initMinimap(source)");
    assert!(
        !script.contains("export "),
        "the exported page's copy is still a module, which a browser will not load off a disk: {}",
        &script[..script.len().min(400)]
    );
    // Nothing on the page imports it, so the file has to start itself — on the element the export's own wrapper puts the document in.
    assert!(
        script
            .trim_end()
            .ends_with("initMinimap(document.querySelector('.document-body'));"),
        "the exported page's copy never calls itself: {}",
        &script[script.len().saturating_sub(400)..]
    );
}

/// Where that rail stands, which on the exported page nothing else in the stylesheet can say.
///
/// The script appends the rail straight to the body, outside `.app-surface`, so every other placement rule in the file is keyed too deep to reach it — and the rules that do reach it must be keyed on `leaf-web`, the class only an exported page wears, because this whole stylesheet is what leaftext.com and empty.guru are handed and each of those places its own rail already. Hidden is the default and the default is the print rule: the rail is fixed, and a fixed element repeats on every sheet.
#[test]
fn the_exported_pages_rail_is_placed_by_the_class_only_that_page_wears() {
    let css = reading_mode_css();
    // Hidden first, which is what a printed sheet and a phone both get.
    assert_contains(
        css,
        "body.leaf-web .document-minimap {
  display: none;
}",
    );
    // The width the site script itself gives up below, so the rail and the arithmetic agree.
    assert_contains(css, "@media screen and (min-width: 721px) {");
    assert_contains(
        css,
        "body.leaf-web .document-minimap {
    display: block;
    position: fixed;",
    );
    // The app carries the clone's scale on a frame element this script never makes.
    assert_contains(
        css,
        "body.leaf-web .document-minimap-preview {
    transform-origin: 0 0;
  }",
    );
    // Asked of the rail rather than written flat, so a page whose script never arrived keeps its scrollbar. Two branches because `scrollbar-width` on the element kills every ::-webkit-scrollbar rule for it.
    assert_contains(
        css,
        "body.leaf-web:has(.document-minimap) {
    scrollbar-width: none;",
    );
    assert_contains(
        css,
        "body.leaf-web:has(.document-minimap)::-webkit-scrollbar {
    width: 0;",
    );
    // The paper state hides the app's own grid cell, never this rail — joining that list would hide it on screen too, since the exported body wears `leaf-paper` for ever.
    let paper = css
        .split("body.leaf-paper :is(")
        .nth(1)
        .expect("the paper state's control list");
    let list = &paper[..paper.find(") {").expect("the end of that list")];
    assert!(
        !list.contains(".document-minimap"),
        "the exported page's rail joined the list the paper state hides, which it wears for ever: {list}"
    );
}

/// What a picture export sees: the page beyond the window, as a screenshot. A drawn diagram lets the browser skip its own paint while it is off screen, so every drawing below the window came out an empty block; and a box still waiting when the sheet is rendered prints its stalled spinner. Both are answered under the paper class alone, so nothing here reaches a screen.
#[test]
fn the_paper_rules_paint_every_drawn_diagram_and_take_the_waiting_ring_off_the_sheet() {
    let css = reading_mode_css();
    // The rail's own answer to the same skip, keyed on the paper class: important, because the skip is written on the block itself.
    assert_contains(
        css,
        "body.leaf-paper .document-body pre.mermaid {\n  content-visibility: visible !important;\n}",
    );
    // The three conditions are the spinner rule's own, so the paper class is what outweighs it whatever order the stylesheet's parts are joined in.
    assert_contains(
        css,
        "body.leaf-paper .document-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]):not([data-diagram-wait=\"far\"])::after {\n  content: none;\n}",
    );
    // Both rules are the paper's: a screen never wears the class, so a screen keeps its skip and its spinner.
    assert!(
        !css.contains("\n.document-body pre.mermaid {\n  content-visibility: visible !important;"),
        "the paint skip was taken off every screen rather than off the paper alone"
    );
}

/// The sheet an exported page names is the one its own theme wears, and two pages pinned to different themes therefore name different files.
///
/// The `assets` folder beside the page is shared — that is what lets two documents exported into one folder share their pictures — so one fixed stylesheet name would leave whichever page was written first pointing at somebody else's drawings. The name is per pack rather than per family, since families wearing the same pack get identical bytes and can share the file.
#[test]
fn an_exported_page_names_the_sheet_its_own_theme_wears() {
    // Amaranth wears an outside pack and Sage the app's own, so the two are the case this exists for.
    let outside = exported_page_stylesheet("amaranth");
    let own = exported_page_stylesheet("sage");
    assert_eq!(outside, "assets/app-heroicons.css");
    assert_eq!(own, "assets/app-leaftext.css");
    assert_ne!(outside, own, "two packs shared one file name");

    // The page links what the writer writes, off the same helper, so the two can never disagree.
    for (theme, sheet) in [("amaranth", &outside), ("sage", &own)] {
        let page = exported_page_document(theme, "light", "Notes", "", "<p>hi</p>");
        assert_contains(
            &page,
            &format!("<link rel=\"stylesheet\" href=\"{sheet}\">"),
        );
    }

    // Halcyon wears heroicons too, so it shares the file rather than writing a second copy of the same bytes.
    assert_eq!(exported_page_stylesheet("halcyon"), outside);

    // A theme name no family has still names a file a browser can fetch, rather than an empty one.
    assert_eq!(
        exported_page_stylesheet("no-such-family"),
        "assets/app-leaftext.css"
    );
}
