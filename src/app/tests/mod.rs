//! Tests for the binary. Split by subject; helpers shared across those files live here.

use super::*;
use std::{
    io,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

mod asks;
mod commands;
mod editing;
mod export;
mod file_actions;
mod growl;
mod history;
mod link_preview;
mod links;
mod log;
mod platform;
mod remote;
mod session;
mod source_view;
mod tabs;
mod undo_bin;
mod updater;
mod vault_corpus;
mod vaults;
mod watch;
mod window;

/// A scratch folder of this test's own — the binary's copy of the library's `scratch_dir`, because this file is the binary crate's and cannot see `src/tests/`.
///
/// The label separates two tests: a clock alone ticks slowly enough here to hand two that start together one folder. The process id and one clock reading per run separate two runs.
fn scratch_dir(label: &str) -> PathBuf {
    static RUN: OnceLock<u128> = OnceLock::new();
    let run = RUN.get_or_init(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos()
    });
    let dir = std::env::temp_dir().join(format!("leaf-{label}-{}-{run}", std::process::id()));
    fs::create_dir_all(&dir).expect("scratch directory is created");
    dir
}

#[test]
fn two_scratch_folders_asked_for_under_different_names_are_never_the_same_folder() {
    // Handed in rather than written into the call, so the guard below reads only real call sites.
    let one = "two-scratch-folders-one";
    let other = "two-scratch-folders-other";
    let first = scratch_dir(one);
    let second = scratch_dir(other);

    assert_ne!(first, second, "two names are two folders");
    assert_eq!(
        first,
        scratch_dir(one),
        "and one name is one folder, which is why no two tests may share a name"
    );

    let _ = fs::remove_dir_all(&first);
    let _ = fs::remove_dir_all(&second);
}

/// A tab open on `path`, seeded from `saved` and typed on so it is dirty.
fn dirty_tab_workspace(path: &Path, saved: &str, typed: &str) -> Workspace {
    let mut workspace = Workspace::default();
    workspace.open_path(path.to_path_buf());
    let end = saved.len();
    workspace.tabs[0]
        .edit_buffer(path, SourceText::utf8(saved.to_string()))
        .replace_range(end, end, typed);
    workspace
}

/// Build a distinct anchor for scroll-history tests; the block ordinal keeps the entries identifiable.
fn test_anchor(block: u32) -> ScrollAnchor {
    ScrollAnchor {
        section: None,
        block,
        offset_y: 0.0,
    }
}

/// A folder of its own per journal test, and per run: these write real files, so two runs of the suite at once must not land on each other either. The one test that spawns a second process tells the child which folder rather than letting it work the name out, because the child's own process id is a different number.
fn journal_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("leaf-journal-{}-{name}", std::process::id()))
}
