//! The parts the stylesheet is cut into, and the one cascade order the concatenation has to keep.

use super::*;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

/// The paths in `READING_CSS_PARTS`, read out of the source the way `scripts/reading-css.mjs` reads them, so the list the checks walk and the list the binary compiles are the same list.
fn part_paths() -> Vec<String> {
    let theme = std::fs::read_to_string(repo("src/theme.rs")).expect("src/theme.rs reads");
    let array = theme
        .split_once("READING_CSS_PARTS: &[&str] = &[")
        .and_then(|(_, rest)| rest.split_once("];"))
        .map(|(list, _)| list.to_string())
        .expect("READING_CSS_PARTS is declared in src/theme.rs");
    array
        .split("include_str!(\"")
        .skip(1)
        .filter_map(|entry| entry.split_once('"').map(|(path, _)| format!("src/{path}")))
        .collect()
}

#[test]
fn every_stylesheet_part_is_listed_once_and_every_entry_is_a_file() {
    // A part that nothing lists is a part the browser never gets, and the rules in it simply stop applying — silently, because a stylesheet has no way to say a file is missing. A part listed twice is worse: its rules land in the cascade a second time, after rules that were written to override them.
    let listed = part_paths();
    assert!(
        listed.len() > 1,
        "READING_CSS_PARTS should hold the stylesheet's parts, found {listed:?}"
    );

    let mut seen = BTreeSet::new();
    for path in &listed {
        assert!(
            repo(path).is_file(),
            "READING_CSS_PARTS names {path}, which is not a file"
        );
        assert!(
            seen.insert(path.clone()),
            "READING_CSS_PARTS names {path} twice, so its rules land in the cascade a second time"
        );
    }

    let mut on_disk = BTreeSet::new();
    for entry in std::fs::read_dir(repo("src/assets/reading")).expect("src/assets/reading reads") {
        let entry = entry.expect("a directory entry reads");
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".css") {
            on_disk.insert(format!("src/assets/reading/{name}"));
        }
    }
    for path in &on_disk {
        assert!(seen.contains(path), "{path} sits in src/assets/reading/ and nothing lists it, so none of its rules reach the page");
    }
}

#[test]
fn a_file_name_stays_a_flex_row_across_the_seam_it_is_cut_at() {
    // The one order dependency in this stylesheet that two parts can be separated by. `.library-hit-title` is a block that clips and ellipsizes where it is first written, and a flex row with visible overflow four hundred lines later — the truncation having moved to `.file-name-stem` inside it. Both rules carry the same specificity, so nothing but their order decides which wins, and a part moved out of order would put the ellipsis back on the outside and cut every file name in the search results short.
    let css = reading_mode_css();

    let clipped = css
        .find(".library-hit-title {\n  display: block;")
        .expect("the block-and-clip rule is served");
    let opened = css
        .find(".library-hit-title,\n.home-row-name {\n  display: flex;")
        .expect("the flex-row rule is served");
    let unclipped = css
        .find(".library-hit-title {\n  overflow: visible;")
        .expect("the visible-overflow rule is served");

    assert!(clipped < opened, "the flex row must come after the block, or a file name in the search results is not a row at all");
    assert!(clipped < unclipped, "the visible overflow must come after the hidden one, or every file name in the search results is cut short");
}

#[test]
fn the_served_stylesheet_is_every_part_in_the_arrays_order_and_nothing_between_them() {
    // The sheet the browser is handed is the parts joined with **nothing** — no separator, nothing before the first and nothing after the last. A `join("\n")` would be the easy mistake and it is not a small one: a character the old file did not have breaks the byte-equality every future move is proved against.
    //
    // It cannot catch a part listed in the wrong order, and nothing can: the array is the order, so moving an entry moves the truth with it. What names a cascade fact rather than restating the array is the test above.
    let served = reading_mode_css();
    let mut joined = String::new();
    for path in part_paths() {
        joined.push_str(
            &std::fs::read_to_string(repo(&path)).unwrap_or_else(|_| panic!("{path} reads")),
        );
    }
    assert!(
        served.ends_with(&joined),
        "the served stylesheet does not end in the parts joined in the array's order"
    );

    // And nothing of the sheet lives anywhere else: the parts are the whole of it.
    let mut at = 0;
    for path in part_paths() {
        let part = std::fs::read_to_string(repo(&path)).unwrap_or_else(|_| panic!("{path} reads"));
        let found = served[at..]
            .find(&part)
            .unwrap_or_else(|| panic!("{path} is not in the served stylesheet"))
            + at;
        assert!(found >= at, "{path} is served before the part above it");
        at = found + part.len();
    }
    assert_eq!(
        at,
        served.len(),
        "the served stylesheet carries something after its last part"
    );
}
