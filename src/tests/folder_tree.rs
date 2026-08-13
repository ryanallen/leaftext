//! The library pane's files, read off the disk one folder at a time.

use super::*;

use crate::store::NodeKind;

fn tree_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("leaf-folder-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("temp dir created");
    dir
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent created");
    }
    fs::write(path, contents).expect("file written");
}

fn names(listing: &FolderListing) -> Vec<String> {
    listing
        .entries
        .iter()
        .map(|entry| entry.name.clone())
        .collect()
}

#[test]
fn a_folder_lists_only_itself_with_no_index_and_no_walk_below_it() {
    let dir = tree_dir("listing");
    let root = dir.join("vault");
    write(&root.join("beta.md"), "# Beta\n");
    write(&root.join("alpha.md"), "# Alpha\n");
    write(&root.join("data.json"), "{}\n");
    write(&root.join("notes").join("deep.md"), "# Deep\n");
    write(&root.join("notes").join("under").join("deeper.md"), "# D\n");
    // Not a document, so not a row.
    write(&root.join("photo.png"), "not really a png");

    let top = read_folder_listing(Some(&root), "");
    // The vault's folder is the top: its own children, folders first, then documents, each alphabetical. Nothing from inside `notes` is here — nothing under it has been read.
    assert_eq!(
        names(&top),
        vec!["notes", "alpha.md", "beta.md", "data.json"]
    );
    assert_eq!(top.entries[0].kind, NodeKind::Folder);
    assert!(top.entries[0].children.is_empty());
    // The vault's own folder is the switcher's crumb, so the trail is empty.
    assert!(top.chain.is_empty());
    assert_eq!(top.path, root.to_string_lossy());

    // Opening one reads that folder and nothing else.
    let notes = read_folder_listing(Some(&root), &root.join("notes").to_string_lossy());
    assert_eq!(names(&notes), vec!["under", "deep.md"]);
    // The trail runs from below the vault down to here.
    let chain: Vec<String> = notes.chain.iter().map(|step| step.name.clone()).collect();
    assert_eq!(chain, vec!["notes"]);

    let under = read_folder_listing(
        Some(&root),
        &root.join("notes").join("under").to_string_lossy(),
    );
    let chain: Vec<String> = under.chain.iter().map(|step| step.name.clone()).collect();
    assert_eq!(chain, vec!["notes", "under"]);
    assert_eq!(names(&under), vec!["deeper.md"]);

    // An empty folder is still a folder — it just has nothing in it. Lazily, there is no way to know that without opening it, and no reason to care.
    fs::create_dir_all(root.join("empty")).expect("folder created");
    let listing = read_folder_listing(Some(&root), &root.join("empty").to_string_lossy());
    assert!(listing.entries.is_empty());

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_folder_of_files_the_app_cannot_read_counts_them() {
    let dir = tree_dir("skipped");
    let root = dir.join("vault");
    // The shape the owner hit: a folder of design captures, nothing in it the app reads.
    write(&root.join("index.html"), "<p>one</p>");
    write(&root.join("about.html"), "<p>two</p>");
    write(&root.join("site.css"), "p{}");
    // A folder is always a row, so it can never be one of the missing.
    write(&root.join("notes").join("deep.md"), "# Deep\n");

    let listing = read_folder_listing(Some(&root), "");
    assert_eq!(names(&listing), vec!["notes"]);
    assert_eq!(listing.skipped_files, 3);

    // A folder of documents skipped nothing.
    let notes = read_folder_listing(Some(&root), &root.join("notes").to_string_lossy());
    assert_eq!(names(&notes), vec!["deep.md"]);
    assert_eq!(notes.skipped_files, 0);

    // Neither did an empty one, and neither do the drives, which read no directory at all.
    fs::create_dir_all(root.join("empty")).expect("folder created");
    let empty = read_folder_listing(Some(&root), &root.join("empty").to_string_lossy());
    assert!(empty.entries.is_empty());
    assert_eq!(empty.skipped_files, 0);
    assert_eq!(read_folder_listing(None, "").skipped_files, 0);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

/// A link to a folder, made the way the platform lets an ordinary user make one: a junction on Windows, a symlink everywhere else.
fn link_dir(link: &Path, target: &Path) {
    #[cfg(windows)]
    {
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .expect("mklink runs");
        assert!(
            made.status.success(),
            "a junction is made without elevation"
        );
    }
    #[cfg(not(windows))]
    std::os::unix::fs::symlink(target, link).expect("symlink created");
}

#[test]
fn every_folder_is_listed_even_the_ones_the_pane_used_to_throw_away() {
    let dir = tree_dir("hidden");
    let root = dir.join("vault");
    write(&root.join("plain.md"), "# Plain\n");
    // A leading dot is a Unix convention Windows does not act on, and the pane lists hidden files either way.
    write(&root.join(".agents").join("skill.md"), "# Skill\n");
    write(&root.join(".git").join("COMMIT_EDITMSG.md"), "# Internal\n");
    // A folder called `target` may be somebody's notes on a target.
    write(&root.join("target").join("built.md"), "# Built\n");
    write(&root.join("node_modules").join("pkg.md"), "# Vendored\n");
    // Following a junction can loop, and this listing descends nowhere, so it cannot.
    write(&dir.join("elsewhere").join("linked.md"), "# Linked\n");
    link_dir(&root.join("shortcut"), &dir.join("elsewhere"));

    let top = read_folder_listing(Some(&root), "");
    assert_eq!(
        names(&top),
        vec![
            ".agents",
            ".git",
            "node_modules",
            "shortcut",
            "target",
            "plain.md"
        ]
    );

    // And each one opens.
    let hidden = read_folder_listing(Some(&root), &root.join(".agents").to_string_lossy());
    assert_eq!(names(&hidden), vec!["skill.md"]);
    let built = read_folder_listing(Some(&root), &root.join("target").to_string_lossy());
    assert_eq!(names(&built), vec!["built.md"]);
    // A link opens onto what it points at, the same as it does in the file explorer.
    let followed = read_folder_listing(Some(&root), &root.join("shortcut").to_string_lossy());
    assert_eq!(names(&followed), vec!["linked.md"]);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn the_os_furniture_is_skipped_at_the_top_of_a_drive_and_nowhere_else() {
    // The one name rule left, and it fires only where the name is known to be the OS's.
    let os_names = [
        "Library",
        "AppData",
        "Windows",
        "Program Files",
        "Program Files (x86)",
        "ProgramData",
        "System Volume Information",
        "$RECYCLE.BIN",
        "proc",
        "sys",
    ];

    let root = crate::store::detect_roots()
        .into_iter()
        .next()
        .expect("there is always at least one drive");
    let listing = read_folder_listing(None, &root.to_string_lossy());
    for name in os_names {
        assert!(
            !names(&listing).contains(&name.to_string()),
            "{name} should not be listed at the top of a drive"
        );
    }

    // The same name deeper in is somebody's own folder, so it is listed.
    let dir = tree_dir("system-names");
    let vault = dir.join("vault");
    for name in os_names {
        write(&vault.join(name).join("note.md"), "# Note\n");
    }
    let listing = read_folder_listing(Some(&vault), "");
    let mut expected: Vec<String> = os_names.iter().map(|name| name.to_string()).collect();
    expected.sort_by_key(|name| name.to_lowercase());
    assert_eq!(names(&listing), expected);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_folder_outside_the_vault_or_gone_falls_back_to_the_top() {
    let dir = tree_dir("fallback");
    let root = dir.join("vault");
    write(&root.join("inside.md"), "# Inside\n");
    write(&dir.join("outside").join("other.md"), "# Other\n");

    // A path from before a vault switch is not this vault's to show.
    let escaped = read_folder_listing(Some(&root), &dir.join("outside").to_string_lossy());
    assert_eq!(escaped.path, root.to_string_lossy());
    assert_eq!(names(&escaped), vec!["inside.md"]);

    // A folder that has since been deleted lands at the top, not on an empty pane with no way out.
    let gone = read_folder_listing(Some(&root), &root.join("not-here").to_string_lossy());
    assert_eq!(gone.path, root.to_string_lossy());

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn the_whole_library_starts_at_the_drive_roots() {
    // No vault: the top level is the drives — the one listing that reads no directory at all.
    let listing = read_folder_listing(None, "");
    assert!(listing.path.is_empty());
    assert!(listing.chain.is_empty());
    assert!(
        !listing.entries.is_empty(),
        "there is always at least one drive"
    );
    assert!(listing
        .entries
        .iter()
        .all(|entry| entry.kind == NodeKind::Folder));

    // Opening a real folder under a drive gives a trail that starts at the drive itself.
    let dir = tree_dir("drive");
    write(&dir.join("note.md"), "# Note\n");
    let listing = read_folder_listing(None, &dir.to_string_lossy());
    assert_eq!(names(&listing), vec!["note.md"]);
    let last = listing.chain.last().expect("the trail ends where we are");
    assert_eq!(last.path, dir.to_string_lossy());
    let first = listing
        .chain
        .first()
        .expect("the trail starts at the drive");
    assert!(
        Path::new(&first.path).parent().is_none(),
        "the trail should start at a drive root, got {first:?}"
    );

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn the_file_list_starts_with_a_way_back_out() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // First row of the list, above the folder's own contents.
    assert!(html.contains("const parent = libraryParentCrumb();"));
    assert!(html.contains("if (parent) rows.push(upRowHtml(parent));"));
    assert!(html.contains(r#"class="library-nav-folder library-nav-up""#));
    assert!(css.contains(".library-nav-up {"));

    // It goes to the folder above, or to the root from one level in. There is nothing above the top, so no row there — leaving a vault is the switcher's job.
    assert!(html.contains("function libraryParentCrumb()"));
    assert!(html.contains("if (!libraryChain.length) return null;"));
    assert!(html.contains(
        "return parent ? { path: parent.path, name: parent.name } : { path: '', name: libraryRootLabel() };"
    ));
    // It navigates through the same helper every folder row uses, so it too enters on the mouse's press.
    assert!(html.contains(r#"data-nav-into="${escapeAttr(parent.path)}""#));
    assert!(html
        .contains("libraryTree.querySelectorAll('[data-nav-into]').forEach(bindFolderEntryRow);"));
    // An empty folder is exactly where the way out matters, so the rows still render alongside the empty notice.
    assert!(html.contains(
        "const empty = libraryEntries.length\n    ? ''\n    : `<p class=\"library-empty\">${escapeText(libraryEmptyText())}</p>`;"
    ));
    assert!(html
        .contains("if (!setLibraryTreeHtml(renderProject(libraryEntries) + empty)) return false;"));

    assert!(html.contains("const label = `Back to ${parent.name}`;"));
}
