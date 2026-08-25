//! The bottom sheet, and the boxes that wear the bar.

use super::*;

#[test]
fn every_bottom_sheet_is_the_same_bottom_sheet() {
    // The glossary, the theme picker, the flowchart editor's shape picker and a folded start-screen list all slide up from the bottom, and all differ only in what they are anchored to and filled with. A fifth that forgets the class gets no slide and no grip.
    let html = app_shell_page();
    let css = reading_mode_css();

    for sheet in ["glossarySheet", "themeSheet", "flowPicker", "homeSheet"] {
        let at = html
            .find(&format!("id=\"{sheet}\""))
            .unwrap_or_else(|| panic!("{sheet} is in the shell"));
        // The whole opening tag: the class may be written either side of the id.
        let opens = html[..at].rfind('<').unwrap_or(0);
        let shuts = html[at..]
            .find('>')
            .map(|end| at + end)
            .unwrap_or(html.len());
        let tag = &html[opens..shuts];
        assert!(
            tag.contains("leaf-sheet"),
            "{sheet} is a bottom sheet but does not wear the class: {tag}"
        );
    }
    // One grab bar and one X, each defined once.
    assert_eq!(html.matches("class=\"leaf-sheet-grip\"").count(), 4);
    assert_eq!(html.matches("class=\"leaf-sheet-close\"").count(), 4);
    for bespoke in [
        ".glossary-sheet-grip",
        ".theme-sheet-grip",
        ".glossary-sheet-close",
        ".theme-sheet-close",
    ] {
        assert!(
            !css.contains(bespoke),
            "a sheet has grown its own `{bespoke}` again"
        );
    }
    assert_contains(&css, ".leaf-sheet-close {");
    assert_contains(&css, ".leaf-sheet-grip {");
    assert_contains(&css, ".leaf-sheet.open {");
    // And one scrim behind all of them, rather than five identical ones — the four sheets plus the confirmation, which is not a sheet but dims the page the same way. The flowchart picker opens over the flow sheet, so only its layer differs.
    assert_eq!(html.matches("class=\"lt-backdrop\"").count(), 5);
    assert_contains(&css, ".lt-backdrop {");
    assert_contains(
        rule_body(&css, "#flowBackdrop {"),
        "z-index: var(--lt-z-42);",
    );
    for gone in [
        ".glossary-backdrop",
        ".theme-sheet-backdrop",
        ".flow-sheet-backdrop",
    ] {
        assert!(
            !css.contains(gone),
            "a sheet has grown its own scrim again: {gone}"
        );
    }
    // One spinner shape and one turn, however many places spin.
    assert_contains(&css, ".lt-spinner {");
    assert_contains(&css, "@keyframes lt-spin {");
    for gone in ["leaf-reader-spin", "theme-item-spin", "library-sync-spin"] {
        let keyframe = format!("@keyframes {gone}");
        assert!(
            !css.contains(&keyframe),
            "a second spin keyframe is back: {gone}"
        );
    }
    // And the app's scrollbar is one definition too, worn by everything that draws one — a class where the markup is ours, a selector where it is rendered from Markdown.
    assert_contains(&css, ".leaf-scroll::-webkit-scrollbar-thumb,");
    for wearer in [
        ".library-scroll::-webkit-scrollbar-thumb,",
        ".reader-shell:not(.has-minimap)::-webkit-scrollbar-thumb,",
        ".table-lane > table::-webkit-scrollbar-thumb,",
        ".document-body :is(pre, pre > code, .math-display, .frontmatter, table)::-webkit-scrollbar-thumb {",
    ] {
        assert_contains(&css, wearer);
    }
    // A second definition is how the pane ended up with a bar 10px wide beside a reader's at 14. Five wearers named in each of three blocks — the thumb, and the floor under its length per axis. Nothing else may paint a thumb: a private copy is how the app ends up with two answers to when a bar is there. The fade sits on the box, where the stylesheet's universal reduced-motion block reaches it, so the thumb needs none of its own.
    assert_eq!(css.matches("::-webkit-scrollbar-thumb").count(), 15);
    // Where the markup is ours the box carries the class, which is the whole of joining: the shape picker, the theme picker's grid of cards, a glossary entry, the flowchart canvas and the code panel beside it. One of these missing it is a box drawing the platform's gray stripe in a window where nothing else does.
    for (id, what) in [
        ("flowPickerBody", "the shape picker"),
        ("themeSheetGrid", "the theme picker's grid of cards"),
        ("glossarySheetBody", "a glossary entry"),
        ("flowCanvas", "the flowchart canvas"),
        ("flowCode", "the code panel beside the canvas"),
    ] {
        let at = html
            .find(&format!("id=\"{id}\""))
            .unwrap_or_else(|| panic!("{what} is in the shell"));
        let opens = html[..at].rfind('<').unwrap_or(0);
        let shuts = html[at..]
            .find('>')
            .map(|end| at + end)
            .unwrap_or(html.len());
        let tag = &html[opens..shuts];
        assert!(
            tag.contains("leaf-scroll"),
            "{what} scrolls and wears the platform's bar instead of the app's: {tag}"
        );
    }
}

/// One CSS selector list split at its own commas. A comma inside `:is(...)` groups selectors within a single wearer, so depth is tracked; whitespace is squeezed because the stylesheet separates its entries with newlines and the script with spaces.
fn wearer_list(list: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    for ch in list.chars() {
        match ch {
            '(' => {
                depth += 1;
                current.push(ch);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                current.push(ch);
            }
            ',' if depth == 0 => {
                out.push(current.split_whitespace().collect::<Vec<_>>().join(" "));
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    let last = current.split_whitespace().collect::<Vec<_>>().join(" ");
    if !last.is_empty() {
        out.push(last);
    }
    out
}

#[test]
fn the_list_of_boxes_wearing_the_bar_is_the_same_list_in_both_files() {
    // The bar is painted from the stylesheet and raised from the script, and each holds its own copy of which boxes wear it. A box in one and not the other gets half of it: painted but impossible to aim at, or aimable and never drawn. Nothing held the two together, and the copy in the script is the one a stylesheet edit forgets.
    let css = reading_mode_css();
    let script = app_shell_script();

    let resting = rule_body(&css, ".leaf-scroll,");
    let painted = &resting[..resting.find('{').expect("the resting rule opens")];

    const NAMED: &str = "LEAF_SCROLL_WEARERS = '";
    let at = script
        .find(NAMED)
        .expect("the script names the boxes whose bar the pointer can raise");
    let rest = &script[at + NAMED.len()..];
    let aimable = &rest[..rest.find('\'').expect("the list is one quoted string")];

    let mut painted = wearer_list(painted);
    let mut aimable = wearer_list(aimable);
    painted.sort();
    aimable.sort();
    assert_eq!(
        painted, aimable,
        "the stylesheet and the front end disagree about which boxes wear the app's bar"
    );
}
