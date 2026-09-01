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
mod picture_clipboard;
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

/// The smallest legal package: a zip of one stored member, written here by hand.
///
/// Hand-written because the library's own archive builders sit inside the library's suite and a test of the binary cannot reach them, and because what this stands up is a file the gate reads the end of rather than a document anything draws — a member's name, its checksum and its sizes in the directory is the whole of what the gate looks at.
fn one_member_package(name: &str, contents: &[u8]) -> Vec<u8> {
    let mut crc = flate2::Crc::new();
    crc.update(contents);
    let crc = crc.sum();
    let sizes = |out: &mut Vec<u8>| {
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(contents.len() as u32).to_le_bytes());
        out.extend_from_slice(&(contents.len() as u32).to_le_bytes());
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
    };

    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
    out.extend_from_slice(&[20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    sizes(&mut out);
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(name.as_bytes());
    out.extend_from_slice(contents);

    let directory_at = out.len();
    out.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
    out.extend_from_slice(&[20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    sizes(&mut out);
    out.extend_from_slice(&[0; 10]);
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(name.as_bytes());

    let directory_size = out.len() - directory_at;
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0, 1, 0, 1, 0]);
    out.extend_from_slice(&(directory_size as u32).to_le_bytes());
    out.extend_from_slice(&(directory_at as u32).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
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
