//! Index tests: schema migration, scanning, chunking, search, and the worker.

use super::*;
use std::sync::atomic::AtomicU64;

fn unique_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("leaf-indexer-{tag}-{nanos}-{n}"));
    std::fs::create_dir_all(&dir).expect("temp dir created");
    dir
}

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("parent created");
    }
    std::fs::write(path, contents).expect("file written");
}

/// Run a scan over an explicit root (not the whole device).
fn scan(conn: &mut Connection, root: &Path) {
    let roots = ensure_roots(conn, &[root.to_path_buf()]).expect("roots ensured");
    let cancel = Arc::new(AtomicBool::new(false));
    run_scan(conn, &roots, &cancel, &|_| {}).expect("scan ran");
}

fn flatten_paths(nodes: &[FileTreeNode], out: &mut Vec<String>) {
    for node in nodes {
        match node.kind {
            NodeKind::File => out.push(node.path.clone()),
            NodeKind::Folder => flatten_paths(&node.children, out),
        }
    }
}

fn status_of(conn: &Connection, abs: &str) -> Option<String> {
    conn.query_row(
        "SELECT status FROM files WHERE abs_path = ?1",
        params![abs],
        |row| row.get(0),
    )
    .ok()
}

fn title_of(conn: &Connection, abs: &str) -> Option<String> {
    conn.query_row(
        "SELECT title FROM files WHERE abs_path = ?1",
        params![abs],
        |row| row.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

#[test]
fn migrations_create_schema_at_current_version() {
    let dir = unique_dir("migrate");
    let conn = open_db(&dir).expect("db opens");
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("version row");
    assert_eq!(version, SCHEMA_VERSION);
    // Every table the indexer + full-text-search plans name exists.
    for table in [
        "scan_roots",
        "scan_runs",
        "scan_run_roots",
        "files",
        "headings",
        "file_feature_state",
        "chunks",
        "chunks_fts",
        "frontmatter",
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name=?1",
                params![table],
                |row| row.get(0),
            )
            .expect("table query");
        assert!(count >= 1, "missing table {table}");
    }
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reopening_keeps_indexed_files_and_does_not_remigrate() {
    // Stand in for "an older manifest upgrades without losing indexed files":
    // a second open runs no migration and the rows survive.
    let dir = unique_dir("reopen");
    let root = dir.join("vault");
    write_file(&root.join("note.md"), "# Note\n");
    {
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
    }
    let conn = open_db(&dir).expect("db reopens");
    let files: i64 = conn
        .query_row("SELECT COUNT(*) FROM files WHERE status='ok'", [], |row| {
            row.get(0)
        })
        .expect("count");
    assert_eq!(files, 1);
    let migrations: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("count");
    assert_eq!(migrations, SCHEMA_VERSION);
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn builds_pruned_tree_with_titles_and_status_filter() {
    let dir = unique_dir("tree");
    let root = dir.join("vault");
    write_file(&root.join("README.md"), "# Guide\n\ncontent");
    write_file(&root.join("docs").join("intro.md"), "# Intro\n");
    write_file(
        &root.join("docs").join("deep").join("more.md"),
        "no heading\n",
    );
    // A folder with no Markdown must be pruned away.
    std::fs::create_dir_all(root.join("empty-folder")).expect("empty dir");
    // A non-Markdown file is ignored.
    write_file(&root.join("notes.txt"), "ignored");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let tree = build_tree(&conn).expect("tree built");

    // One root node.
    assert_eq!(tree.len(), 1);
    let root_node = &tree[0];
    assert_eq!(root_node.kind, NodeKind::Folder);

    let mut paths = Vec::new();
    flatten_paths(&tree, &mut paths);
    assert_eq!(paths.len(), 3, "three Markdown files");
    assert!(paths.iter().any(|p| p.ends_with("README.md")));
    assert!(paths.iter().any(|p| p.ends_with("more.md")));

    // Empty folder pruned: the only child folder is `docs`.
    let folder_names: Vec<&str> = root_node
        .children
        .iter()
        .filter(|c| c.kind == NodeKind::Folder)
        .map(|c| c.name.as_str())
        .collect();
    assert_eq!(folder_names, vec!["docs"]);

    // Title comes from the first H1; the headingless file falls back to its
    // file name.
    let readme = root_node
        .children
        .iter()
        .find(|c| c.name == "README.md")
        .expect("readme node");
    assert_eq!(readme.title.as_deref(), Some("Guide"));
    let more = {
        let docs = root_node
            .children
            .iter()
            .find(|c| c.name == "docs")
            .expect("docs node");
        let deep = docs
            .children
            .iter()
            .find(|c| c.name == "deep")
            .expect("deep node");
        deep.children
            .iter()
            .find(|c| c.name == "more.md")
            .expect("more node")
            .clone()
    };
    assert_eq!(more.title.as_deref(), Some("more"));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn manual_index_adds_a_single_file_in_normal_form() {
    // The live-update path indexes one file outside any crawl; it must land
    // in the manifest at the exact path passed.
    let dir = unique_dir("manual");
    let file = dir.join("note.md");
    write_file(&file, "# Note\n");

    let mut conn = open_db(&dir).expect("db opens");
    sync_single_file(&mut conn, &file, &|_| {});

    let stored: String = conn
        .query_row("SELECT abs_path FROM files WHERE status='ok'", [], |row| {
            row.get(0)
        })
        .expect("one indexed file");
    assert_eq!(stored, path_to_string(&file));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn manual_indexing_a_directory_syncs_nested_files_and_forgets_removed_entries() {
    let dir = unique_dir("manual-dir");
    let root = dir.join("vault");
    let nested = root.join("notes");
    let first = nested.join("first.md");
    let second = nested.join("second.md");

    write_file(&first, "# First\n");
    write_file(&second, "# Second\n");

    let mut conn = open_db(&dir).expect("db opens");
    sync_single_file(&mut conn, &root, &|_| {});

    let mut paths = Vec::new();
    flatten_paths(&build_tree(&conn).expect("tree built"), &mut paths);
    assert!(
        paths.iter().any(|path| path.ends_with("first.md")),
        "directory sync indexes nested markdown files"
    );
    assert!(
        paths.iter().any(|path| path.ends_with("second.md")),
        "directory sync indexes all markdown files in the subtree"
    );

    std::fs::remove_file(&second).expect("removed second");
    let third = nested.join("third.md");
    write_file(&third, "# Third\n");

    sync_single_file(&mut conn, &root, &|_| {});

    let mut paths = Vec::new();
    flatten_paths(&build_tree(&conn).expect("tree built"), &mut paths);
    assert!(
        paths.iter().any(|path| path.ends_with("first.md")),
        "unchanged files remain"
    );
    assert!(
        paths.iter().any(|path| path.ends_with("third.md")),
        "new files in a watched directory are added"
    );
    assert!(
        paths.iter().all(|path| !path.ends_with("second.md")),
        "removed files under the changed directory are forgotten"
    );

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(windows)]
#[test]
fn manual_index_normalizes_a_verbatim_watcher_path() {
    // The file watcher reports paths with the `\\?\` prefix; indexing one
    // must store normal form under the existing drive root, not a duplicate
    // `\\?\C:` root.
    let dir = unique_dir("verbatim");
    let file = dir.join("note.md");
    write_file(&file, "# Note\n");
    let verbatim = std::fs::canonicalize(&file).expect("canonicalize");
    assert!(
        verbatim.to_string_lossy().starts_with(r"\\?\"),
        "precondition: canonicalize yields a verbatim path"
    );

    let mut conn = open_db(&dir).expect("db opens");
    sync_single_file(&mut conn, &verbatim, &|_| {});

    let stored: String = conn
        .query_row("SELECT abs_path FROM files WHERE status='ok'", [], |row| {
            row.get(0)
        })
        .expect("one indexed file");
    assert!(
        !stored.starts_with(r"\\?\"),
        "stored path must be normal form, got {stored}"
    );

    let mut stmt = conn.prepare("SELECT path FROM scan_roots").unwrap();
    let roots: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(roots.len(), 1, "exactly one scan root, got {roots:?}");
    assert!(
        !roots[0].starts_with(r"\\?\"),
        "scan root must be normal form, got {}",
        roots[0]
    );

    drop(stmt);
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn indexes_oversized_from_prefix_and_keeps_unreadable_out_of_the_tree() {
    let dir = unique_dir("status");
    let root = dir.join("vault");
    write_file(&root.join("ok.md"), "# Ok\n");
    // Binary-looking content (NUL byte) -> unreadable.
    write_file(&root.join("binary.md"), "before\u{0}after");
    // Oversized: a real H1 in the leading prefix, then filler past the cap.
    let big = format!("# Huge\n\n{}", "a ".repeat(MAX_INDEX_BYTES as usize));
    write_file(&root.join("huge.md"), &big);

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    assert_eq!(
        status_of(&conn, &path_to_string(&root.join("binary.md"))).as_deref(),
        Some("unreadable")
    );
    // The oversized file is indexed (from its prefix), not skipped.
    assert_eq!(
        status_of(&conn, &path_to_string(&root.join("huge.md"))).as_deref(),
        Some("ok")
    );

    let tree = build_tree(&conn).expect("tree built");
    let mut paths = Vec::new();
    flatten_paths(&tree, &mut paths);
    // Both the small and the oversized file show; only the binary one is hidden.
    assert_eq!(paths.len(), 2, "the ok and oversized files show");
    assert!(paths.iter().any(|p| p.ends_with("ok.md")));
    assert!(paths.iter().any(|p| p.ends_with("huge.md")));
    assert!(paths.iter().all(|p| !p.ends_with("binary.md")));

    // Its title came from the H1 in the indexed prefix.
    assert_eq!(
        title_of(&conn, &path_to_string(&root.join("huge.md"))).as_deref(),
        Some("Huge")
    );

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn skips_junk_directories() {
    let dir = unique_dir("junk");
    let root = dir.join("vault");
    write_file(&root.join("keep.md"), "# Keep\n");
    write_file(&root.join("node_modules").join("dep.md"), "# Dep\n");
    write_file(&root.join(".git").join("hook.md"), "# Hook\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let tree = build_tree(&conn).expect("tree built");
    let mut paths = Vec::new();
    flatten_paths(&tree, &mut paths);
    assert_eq!(paths.len(), 1);
    assert!(paths[0].ends_with("keep.md"));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn marks_removed_files_missing_on_a_completed_rescan() {
    let dir = unique_dir("missing");
    let root = dir.join("vault");
    let keep = root.join("keep.md");
    let gone = root.join("gone.md");
    write_file(&keep, "# Keep\n");
    write_file(&gone, "# Gone\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    assert_eq!(
        status_of(&conn, &path_to_string(&gone)).as_deref(),
        Some("ok")
    );

    std::fs::remove_file(&gone).expect("file removed");
    scan(&mut conn, &root);

    assert_eq!(
        status_of(&conn, &path_to_string(&gone)).as_deref(),
        Some("missing")
    );
    assert_eq!(
        status_of(&conn, &path_to_string(&keep)).as_deref(),
        Some("ok")
    );
    // Missing files drop out of the tree.
    let tree = build_tree(&conn).expect("tree built");
    let mut paths = Vec::new();
    flatten_paths(&tree, &mut paths);
    assert_eq!(paths.len(), 1);
    assert!(paths[0].ends_with("keep.md"));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn version_bump_reparses_stale_files_with_unchanged_bytes() {
    // Age a row's derived_version: the next scan must reparse it despite
    // unchanged mtime + size, restoring it to current.
    let dir = unique_dir("bump");
    let root = dir.join("vault");
    let note = root.join("note.md");
    write_file(&note, "# Note\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let abs = path_to_string(&note);

    conn.execute(
        "UPDATE files SET derived_version = 0, content_hash = 'stale' WHERE abs_path = ?1",
        params![abs],
    )
    .expect("aged row");

    scan(&mut conn, &root);

    let (derived, hash): (i64, Option<String>) = conn
        .query_row(
            "SELECT derived_version, content_hash FROM files WHERE abs_path = ?1",
            params![abs],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("row");
    assert_eq!(derived, CURRENT_DERIVED_VERSION);
    assert_ne!(hash.as_deref(), Some("stale"), "content was rehashed");

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fast_path_keeps_unchanged_files_and_reparses_edited_ones() {
    let dir = unique_dir("fastpath");
    let root = dir.join("vault");
    let note = root.join("note.md");
    write_file(&note, "# One\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let abs = path_to_string(&note);
    let (hash_before, title_before): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT content_hash, title FROM files WHERE abs_path = ?1",
            params![abs],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("row");
    assert_eq!(title_before.as_deref(), Some("One"));

    // Tag the row so we can tell whether the fast path skipped the rewrite.
    conn.execute(
        "UPDATE files SET error = 'sentinel' WHERE abs_path = ?1",
        params![abs],
    )
    .expect("sentinel set");
    scan(&mut conn, &root);
    let sentinel: Option<String> = conn
        .query_row(
            "SELECT error FROM files WHERE abs_path = ?1",
            params![abs],
            |row| row.get(0),
        )
        .expect("row");
    assert_eq!(
        sentinel.as_deref(),
        Some("sentinel"),
        "unchanged file fast-pathed (no rewrite cleared the sentinel)"
    );

    // Edit the file: the change must be picked up (write clears the sentinel
    // and updates the hash + title).
    write_file(&note, "# Two\n\nmore text");
    scan(&mut conn, &root);
    let (hash_after, title_after, error_after): (Option<String>, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT content_hash, title, error FROM files WHERE abs_path = ?1",
            params![abs],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("row");
    assert_eq!(title_after.as_deref(), Some("Two"));
    assert_eq!(error_after, None, "rewrite cleared the sentinel");
    assert_ne!(hash_after, hash_before, "edited file rehashed");

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cancelled_scan_does_not_mark_files_missing() {
    let dir = unique_dir("cancel");
    let root = dir.join("vault");
    write_file(&root.join("a.md"), "# A\n");
    write_file(&root.join("b.md"), "# B\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    // A pre-cancelled scan must not demote the existing files.
    let roots = ensure_roots(&conn, &[root.clone()]).expect("roots");
    let cancel = Arc::new(AtomicBool::new(true));
    run_scan(&mut conn, &roots, &cancel, &|_| {}).expect("scan ran");

    for name in ["a.md", "b.md"] {
        assert_eq!(
            status_of(&conn, &path_to_string(&root.join(name))).as_deref(),
            Some("ok"),
            "{name} stayed ok after a cancelled scan"
        );
    }

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn feature_state_roundtrip_supports_retry() {
    // The plumbing later features rely on: ready/failed/current/clear.
    let dir = unique_dir("feature");
    let root = dir.join("vault");
    let note = root.join("note.md");
    write_file(&note, "# Note\n");
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    let (file_id, hash): (i64, String) = conn
        .query_row(
            "SELECT id, content_hash FROM files WHERE abs_path = ?1",
            params![path_to_string(&note)],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("row");

    // Use a hypothetical feature name ("tags") so this exercises the generic
    // plumbing without colliding with `chunks`, which the scan now builds and
    // marks ready for real.
    assert!(!is_feature_current(&conn, file_id, "tags", 1, Some(&hash)).unwrap());
    mark_feature_failed(&conn, file_id, "tags", 1, &hash, "boom").unwrap();
    assert!(
        !is_feature_current(&conn, file_id, "tags", 1, Some(&hash)).unwrap(),
        "a failed feature is not current, so it retries"
    );
    mark_feature_ready(&conn, file_id, "tags", 1, &hash).unwrap();
    assert!(is_feature_current(&conn, file_id, "tags", 1, Some(&hash)).unwrap());
    // A schema bump invalidates readiness.
    assert!(!is_feature_current(&conn, file_id, "tags", 2, Some(&hash)).unwrap());
    clear_feature_state(&conn, file_id, "tags").unwrap();
    assert!(!is_feature_current(&conn, file_id, "tags", 1, Some(&hash)).unwrap());

    // The chunks feature, by contrast, is current right after the scan.
    assert!(
        is_feature_current(
            &conn,
            file_id,
            CHUNKS_FEATURE,
            CHUNKS_SCHEMA_VERSION,
            Some(&hash)
        )
        .unwrap(),
        "the scan builds chunks and marks the feature ready"
    );

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn parses_title_and_headings_in_document_order() {
    let parsed = parse_markdown("# Top\n\n## Sub\n\ntext\n\n### Deep\n", "fallback");
    assert_eq!(parsed.title, "Top");
    let depths: Vec<i64> = parsed.headings.iter().map(|h| h.depth).collect();
    assert_eq!(depths, vec![1, 2, 3]);
    let ordinals: Vec<i64> = parsed.headings.iter().map(|h| h.ordinal).collect();
    assert_eq!(ordinals, vec![0, 1, 2]);
    assert_eq!(parsed.headings[1].text, "Sub");

    // No H1: the title falls back to the supplied name.
    let parsed = parse_markdown("## Only sub\n", "my-file");
    assert_eq!(parsed.title, "my-file");
}

#[test]
fn manual_index_adds_a_file_without_a_crawl() {
    // Opening a file indexes it even when no device crawl ever ran (the
    // "Index entire device" toggle being off).
    let dir = unique_dir("manual");
    let root = dir.join("vault");
    let note = root.join("opened.md");
    write_file(&note, "# Opened\n");
    let mut conn = open_db(&dir).expect("db opens");

    sync_single_file(&mut conn, &note, &|_| {});

    let abs = path_to_string(&note);
    assert_eq!(status_of(&conn, &abs).as_deref(), Some("ok"));
    let title: Option<String> = conn
        .query_row(
            "SELECT title FROM files WHERE abs_path = ?1",
            params![abs],
            |row| row.get(0),
        )
        .expect("row");
    assert_eq!(title.as_deref(), Some("Opened"));

    let tree = build_tree(&conn).expect("tree built");
    let mut paths = Vec::new();
    flatten_paths(&tree, &mut paths);
    assert_eq!(paths.len(), 1);
    assert!(paths[0].ends_with("opened.md"));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn sync_forgets_a_file_deleted_from_disk() {
    // After a delete the file is gone from disk; syncing its path must drop
    // it from the manifest and tree without a full rescan.
    let dir = unique_dir("forget");
    let root = dir.join("vault");
    let keep = root.join("keep.md");
    let gone = root.join("gone.md");
    write_file(&keep, "# Keep\n");
    write_file(&gone, "# Gone\n");
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    assert_eq!(
        status_of(&conn, &path_to_string(&gone)).as_deref(),
        Some("ok")
    );

    std::fs::remove_file(&gone).expect("file removed");
    sync_single_file(&mut conn, &gone, &|_| {});

    assert_eq!(status_of(&conn, &path_to_string(&gone)), None);
    let mut paths = Vec::new();
    flatten_paths(&build_tree(&conn).expect("tree built"), &mut paths);
    assert_eq!(paths.len(), 1, "only the surviving file remains");
    assert!(paths[0].ends_with("keep.md"));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

// --- Full-text search -------------------------------------------------

fn file_id_of(conn: &Connection, abs: &str) -> i64 {
    conn.query_row(
        "SELECT id FROM files WHERE abs_path = ?1",
        params![abs],
        |row| row.get(0),
    )
    .expect("file id")
}

fn chunk_rows(conn: &Connection, file_id: i64) -> Vec<(i64, i64, Option<String>, String)> {
    let mut stmt = conn
        .prepare("SELECT ordinal, id, anchor, text FROM chunks WHERE file_id = ?1 ORDER BY ordinal")
        .expect("prepare");
    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .expect("query");
    rows.map(|r| r.expect("row")).collect()
}

fn fts_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM chunks_fts", [], |row| row.get(0))
        .expect("fts count")
}

#[test]
fn chunk_anchors_match_renderer_heading_slugs() {
    // Each chunk's anchor must equal the id the reader gives that heading.
    // Duplicate and punctuated headings exercise the shared slug rules.
    let content = "\
# Hello World

intro text

## Hello World

second section body

## Notes & Stuff

final body
";
    let chunks = chunk_file(content);
    let anchors: Vec<Option<&str>> = chunks.iter().map(|c| c.anchor.as_deref()).collect();
    assert_eq!(
        anchors,
        vec![
            Some("hello-world"),
            Some("hello-world-1"),
            Some("notes--stuff"),
        ]
    );

    // And those are exactly what the renderer's own slug helper produces.
    let mut seen = std::collections::HashSet::new();
    assert_eq!(
        crate::unique_heading_slug("Hello World", &mut seen),
        "hello-world"
    );
    assert_eq!(
        crate::unique_heading_slug("Hello World", &mut seen),
        "hello-world-1"
    );
    assert_eq!(
        crate::unique_heading_slug("Notes & Stuff", &mut seen),
        "notes--stuff"
    );
}

#[test]
fn chunking_is_deterministic_with_contiguous_ordinals() {
    let content = "# A\n\npara one\n\n## B\n\npara two\n\n- item\n- item\n";
    let first = chunk_file(content);
    let second = chunk_file(content);
    assert_eq!(first, second, "same input yields identical chunks");
    let ordinals: Vec<i64> = first.iter().map(|c| c.ordinal).collect();
    assert_eq!(ordinals, (0..first.len() as i64).collect::<Vec<_>>());
    assert!(first
        .iter()
        .all(|c| c.start_line >= 1 && c.end_line >= c.start_line));
}

#[test]
fn content_above_the_first_heading_has_no_anchor() {
    let chunks = chunk_file("preamble text\n\n# Heading\n\nbody\n");
    assert!(chunks.len() >= 2);
    assert_eq!(
        chunks[0].anchor, None,
        "preamble chunk has no heading anchor"
    );
    assert_eq!(chunks[1].anchor.as_deref(), Some("heading"));
}

#[test]
fn empty_document_yields_no_chunks() {
    assert!(chunk_file("").is_empty());
    assert!(chunk_file("   \n\n\t\n").is_empty());
}

#[test]
fn search_finds_files_with_snippets_and_keeps_fts_in_sync() {
    let dir = unique_dir("search");
    let root = dir.join("vault");
    write_file(
        &root.join("install.md"),
        "# Install\n\nRun the installer to install leaftext on your device.\n",
    );
    write_file(
        &root.join("other.md"),
        "# Other\n\nUnrelated content here.\n",
    );

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    // The external-content index has one row per chunk.
    let chunk_total: i64 = conn
        .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
        .expect("chunk count");
    assert_eq!(fts_count(&conn), chunk_total);

    // A content-only term (not in any filename) returns a chunk hit whose
    // snippet carries the STX/ETX highlight markers around the match.
    let hits = search(&conn, "installer", None).expect("search ok");
    assert!(!hits.is_empty(), "query finds the install file");
    assert!(hits[0].abs_path.ends_with("install.md"));
    assert!(hits[0].snippet.contains('\u{2}') && hits[0].snippet.contains('\u{3}'));
    assert!(hits.iter().all(|h| !h.abs_path.ends_with("other.md")));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn search_scope_restricts_results_to_given_paths() {
    let dir = unique_dir("search-scope");
    let root = dir.join("vault");
    write_file(
        &root.join("keep.md"),
        "# Keep\n\nThe dharma teaching appears here.\n",
    );
    write_file(
        &root.join("drop.md"),
        "# Drop\n\nThe dharma teaching also appears here.\n",
    );
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    // Unscoped, both files match; capture keep.md's stored path.
    let all = search(&conn, "dharma", None).expect("search ok");
    assert_eq!(all.len(), 2);
    let keep_path = all
        .iter()
        .find(|h| h.abs_path.ends_with("keep.md"))
        .map(|h| h.abs_path.clone())
        .expect("keep.md matches");

    // Scoped to keep.md: drop.md is excluded even though it matches.
    let scoped = search(&conn, "dharma", Some(&[keep_path])).expect("search ok");
    assert_eq!(scoped.len(), 1);
    assert!(scoped[0].abs_path.ends_with("keep.md"));

    // An empty scope matches nothing (never a raw `IN ()`).
    let empty = search(&conn, "dharma", Some(&[])).expect("search ok");
    assert!(empty.is_empty());

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn search_matches_file_names_not_just_contents() {
    let dir = unique_dir("namesearch");
    let root = dir.join("vault");
    // Filename matches "skill" but the body does not.
    write_file(&root.join("SKILL.md"), "no matching word in this body\n");
    // Body matches "skill" but the filename does not.
    write_file(
        &root.join("guide.md"),
        "# Guide\n\ntalk about skills here\n",
    );
    // Neither matches.
    write_file(&root.join("misc.md"), "# Misc\n\nunrelated content\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    let hits = search(&conn, "skill", None).expect("search ok");
    // The name match leads, then the content match; the unrelated file is out.
    assert!(
        hits[0].abs_path.ends_with("SKILL.md"),
        "name match comes first"
    );
    assert!(
        hits.iter().any(|h| h.abs_path.ends_with("guide.md")),
        "content match too"
    );
    assert!(hits.iter().all(|h| !h.abs_path.ends_with("misc.md")));
    // Each file appears once.
    let skill_count = hits
        .iter()
        .filter(|h| h.abs_path.ends_with("SKILL.md"))
        .count();
    assert_eq!(skill_count, 1);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn editing_a_file_updates_search_results() {
    let dir = unique_dir("livesync");
    let root = dir.join("vault");
    let note = root.join("note.md");
    write_file(&note, "# Note\n\nthe quick brown fox\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    assert!(!search(&conn, "brown", None).expect("search").is_empty());

    write_file(&note, "# Note\n\nthe lazy green turtle\n");
    scan(&mut conn, &root);
    assert!(
        search(&conn, "brown", None).expect("search").is_empty(),
        "old term gone"
    );
    assert!(
        !search(&conn, "turtle", None).expect("search").is_empty(),
        "new term found"
    );
    // FTS rows still match chunk rows after the rewrite.
    let chunk_total: i64 = conn
        .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
        .expect("chunk count");
    assert_eq!(fts_count(&conn), chunk_total);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn replace_chunks_preserves_ids_for_surviving_ordinals() {
    let dir = unique_dir("chunkid");
    let root = dir.join("vault");
    let note = root.join("note.md");
    // Two sections: editing only the second must leave the first chunk's id.
    write_file(&note, "# First\n\nalpha body\n\n# Second\n\nbeta body\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let file_id = file_id_of(&conn, &path_to_string(&note));
    let before = chunk_rows(&conn, file_id);
    let first_id_before = before[0].1;
    assert!(before.len() >= 2);

    write_file(
        &note,
        "# First\n\nalpha body\n\n# Second\n\nbeta body rewritten\n",
    );
    scan(&mut conn, &root);
    let after = chunk_rows(&conn, file_id);
    assert_eq!(
        after[0].1, first_id_before,
        "surviving ordinal 0 kept its id"
    );

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn query_escaping_handles_punctuation_and_blanks() {
    // Blank / operator-only input collapses to no query.
    assert_eq!(escape_fts_query(""), None);
    assert_eq!(escape_fts_query("   \t"), None);
    assert_eq!(escape_fts_query("\"*^():"), None);
    // Real terms survive as quoted prefix tokens; operators are stripped.
    assert_eq!(escape_fts_query("hello"), Some("\"hello\"*".to_string()));
    assert_eq!(
        escape_fts_query("foo bar"),
        Some("\"foo\"* \"bar\"*".to_string())
    );
    assert_eq!(
        escape_fts_query("a*b (c)"),
        Some("\"ab\"* \"c\"*".to_string())
    );
}

#[test]
fn search_does_not_crash_on_hostile_queries() {
    let dir = unique_dir("hostile");
    let root = dir.join("vault");
    write_file(
        &root.join("doc.md"),
        "# Doc\n\nsome searchable words here\n",
    );
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    for query in [
        "",
        "   ",
        "\"",
        "AND OR NOT",
        "foo:bar",
        "a* (b) ^c",
        "\"unterminated",
        "words", // a real one too
    ] {
        let result = search(&conn, query, None);
        assert!(result.is_ok(), "query {query:?} must not error");
    }

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn status_change_removes_chunks_and_search_hits() {
    let dir = unique_dir("statushits");
    let root = dir.join("vault");
    let note = root.join("note.md");
    write_file(&note, "# Note\n\nfindme keyword inside\n");

    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let file_id = file_id_of(&conn, &path_to_string(&note));
    assert!(!search(&conn, "findme", None).expect("search").is_empty());

    // Removing the file then rescanning demotes it to `missing`.
    std::fs::remove_file(&note).expect("removed");
    scan(&mut conn, &root);

    assert_eq!(
        status_of(&conn, &path_to_string(&note)).as_deref(),
        Some("missing")
    );
    assert!(chunk_rows(&conn, file_id).is_empty(), "chunks dropped");
    assert!(
        search(&conn, "findme", None).expect("search").is_empty(),
        "no stale hits"
    );
    let chunk_total: i64 = conn
        .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
        .expect("chunk count");
    assert_eq!(fts_count(&conn), chunk_total);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cjk_search_matches_leading_prefix_documented_behavior() {
    // CJK is best-effort under unicode61: an unspaced Han run is one token, so
    // a query matches only as a leading prefix. Pins the shipped behavior.
    let dir = unique_dir("cjk");
    let root = dir.join("vault");
    write_file(&root.join("zh.md"), "# 测试\n\n安装程序很好用\n");
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    assert!(
        !search(&conn, "安装", None).expect("search").is_empty(),
        "leading prefix of the run matches"
    );
    assert!(
        search(&conn, "程序", None).expect("search").is_empty(),
        "mid-run substring does not match under unicode61"
    );

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn search_results_event_script_targets_the_callback() {
    let event = IndexerEvent::SearchResults {
        query: "hi".to_string(),
        hits: vec![SearchHit {
            abs_path: "C:\\docs\\a.md".to_string(),
            title: "A".to_string(),
            start_line: 1,
            end_line: 3,
            anchor: Some("intro".to_string()),
            snippet: "an [a]nswer".to_string(),
            score: -1.5,
        }],
        error: None,
    };
    let script = event_script(&event);
    assert!(script.starts_with("window.leafSetSearchResults("));
    assert!(script.contains("\"query\":\"hi\""));
    assert!(script.contains("\"absPath\":\"C:\\\\docs\\\\a.md\""));
    assert!(script.contains("\"anchor\":\"intro\""));
    assert!(script.contains("\"error\":null"));

    let failure = event_script(&IndexerEvent::SearchResults {
        query: "x".to_string(),
        hits: Vec::new(),
        error: Some("boom".to_string()),
    });
    assert!(failure.contains("\"message\":\"boom\""));
}

#[test]
fn event_script_builds_callbacks_and_escapes_via_json() {
    let progress = ScanProgress {
        phase: ScanPhase::Scanning,
        files_found: 1240,
    };
    let script = event_script(&IndexerEvent::Progress(progress));
    assert!(script.starts_with("window.leafSetScanProgress("));
    assert!(script.contains("\"phase\":\"scanning\""));
    assert!(script.contains("\"filesFound\":1240"));

    let library = IndexerEvent::Library {
        tree: vec![FileTreeNode {
            name: "README.md".to_string(),
            path: "C:\\docs\\README.md".to_string(),
            kind: NodeKind::File,
            title: Some("Guide".to_string()),
            children: Vec::new(),
        }],
        progress: ScanProgress {
            phase: ScanPhase::Idle,
            files_found: 0,
        },
    };
    let script = event_script(&library);
    assert!(script.starts_with("window.leafSetLibraryState("));
    assert!(script.contains("\"kind\":\"file\""));
    assert!(script.contains("\"error\":null"));

    let error = event_script(&IndexerEvent::Error("DB unavailable".to_string()));
    assert!(error.contains("\"message\":\"DB unavailable\""));
}

// --- Frontmatter ------------------------------------------------------

fn frontmatter_rows(conn: &Connection, file_id: i64) -> Vec<(String, String)> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM frontmatter WHERE file_id = ?1 ORDER BY key, value")
        .expect("prepare");
    let rows = stmt
        .query_map(params![file_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("query");
    rows.map(|r| r.expect("row")).collect()
}

#[test]
fn extracts_only_a_leading_block_and_skips_later_rules() {
    // A real leading block parses.
    let block = extract_frontmatter("---\ntitle: Hi\n---\n\nbody\n").expect("leading block");
    assert_eq!(block.body, "title: Hi\n");

    // A horizontal rule later in the document is not frontmatter.
    assert_eq!(
        extract_frontmatter("# Heading\n\nintro\n\n---\n\nmore\n"),
        None
    );

    // Extraction stops at the first closing fence, so a later `---` rule stays
    // in the body rather than reopening metadata.
    let block =
        extract_frontmatter("---\nstatus: done\n---\n\ntext\n\n---\n\ntail\n").expect("block");
    assert_eq!(block.body, "status: done\n");

    // No closing fence: not a block.
    assert_eq!(extract_frontmatter("---\ntitle: Hi\nno close\n"), None);
}

#[test]
fn extracts_block_after_a_utf8_bom() {
    let block = extract_frontmatter("\u{feff}---\ntitle: Hi\n---\nbody\n").expect("bom block");
    assert_eq!(block.body, "title: Hi\n");
}

#[test]
fn parses_scalars_arrays_and_block_lists() {
    let block = FrontmatterBlock {
        body: "Title: Project Plan\n\
                   status: done\n\
                   due: 2026-07-01\n\
                   draft: true\n\
                   category: [guides, drafts]\n\
                   tags:\n\
                   - rust\n\
                   - desktop\n"
            .to_string(),
    };
    let parsed = parse_frontmatter(&block).expect("parsed");
    let mut fields: Vec<(String, String)> = parsed
        .fields
        .iter()
        .map(|f| (f.key.clone(), f.value.clone()))
        .collect();
    fields.sort();
    assert_eq!(
        fields,
        vec![
            ("category".to_string(), "drafts".to_string()),
            ("category".to_string(), "guides".to_string()),
            ("draft".to_string(), "true".to_string()),
            ("due".to_string(), "2026-07-01".to_string()),
            ("status".to_string(), "done".to_string()),
            ("tags".to_string(), "desktop".to_string()),
            ("tags".to_string(), "rust".to_string()),
            // Keys are lowercased so filters are case-insensitive.
            ("title".to_string(), "Project Plan".to_string()),
        ]
    );
}

#[test]
fn malformed_frontmatter_does_not_fail_the_file() {
    // A block that is not a mapping at all parses to an error...
    let garbage = FrontmatterBlock {
        body: "this is not yaml at all\njust prose\n".to_string(),
    };
    assert_eq!(parse_frontmatter(&garbage), Err(MetadataError::Unparseable));

    // ...but the file still indexes and shows in the tree, with no rows.
    let dir = unique_dir("fm-malformed");
    let root = dir.join("vault");
    let note = root.join("bad.md");
    write_file(
        &note,
        "---\nthis is not yaml at all\njust prose\n---\n\n# Body\n",
    );
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    let abs = path_to_string(&note);
    assert_eq!(status_of(&conn, &abs).as_deref(), Some("ok"));
    let file_id = file_id_of(&conn, &abs);
    assert!(frontmatter_rows(&conn, file_id).is_empty());
    let tree = build_tree(&conn).expect("tree");
    let mut paths = Vec::new();
    flatten_paths(&tree, &mut paths);
    assert_eq!(paths.len(), 1);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn editing_frontmatter_replaces_stale_rows() {
    let dir = unique_dir("fm-rewrite");
    let root = dir.join("vault");
    let note = root.join("note.md");
    write_file(&note, "---\nstatus: draft\n---\n# Note\n");
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let abs = path_to_string(&note);
    let file_id = file_id_of(&conn, &abs);
    assert_eq!(
        frontmatter_rows(&conn, file_id),
        vec![("status".to_string(), "draft".to_string())]
    );

    // Rewriting the block removes the stale value and adds the new one.
    write_file(&note, "---\nstatus: done\n---\n# Note\n");
    scan(&mut conn, &root);
    assert_eq!(
        frontmatter_rows(&conn, file_id),
        vec![("status".to_string(), "done".to_string())]
    );

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn demoted_files_drop_their_frontmatter_rows() {
    let dir = unique_dir("fm-demote");
    let root = dir.join("vault");
    let note = root.join("note.md");
    write_file(&note, "---\nstatus: done\n---\n# Note\n");
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let abs = path_to_string(&note);
    let file_id = file_id_of(&conn, &abs);
    assert!(!frontmatter_rows(&conn, file_id).is_empty());

    // Removing the file then rescanning demotes it and clears its rows.
    std::fs::remove_file(&note).expect("removed");
    scan(&mut conn, &root);
    assert_eq!(status_of(&conn, &abs).as_deref(), Some("missing"));
    assert!(frontmatter_rows(&conn, file_id).is_empty());
    // A demoted file drops out of the tree entirely.
    let tree = build_tree(&conn).expect("tree");
    assert!(tree.is_empty());

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stale_frontmatter_feature_forces_a_reparse() {
    // Backfill: a file with a stale frontmatter feature row is reparsed once
    // despite unchanged mtime + size.
    let dir = unique_dir("fm-backfill");
    let root = dir.join("vault");
    let note = root.join("note.md");
    write_file(&note, "---\nstatus: done\n---\n# Note\n");
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);
    let abs = path_to_string(&note);
    let file_id = file_id_of(&conn, &abs);

    // Simulate a pre-feature file: drop its frontmatter rows and readiness
    // without touching mtime/size.
    conn.execute(
        "DELETE FROM frontmatter WHERE file_id = ?1",
        params![file_id],
    )
    .expect("clear rows");
    clear_feature_state(&conn, file_id, FRONTMATTER_FEATURE).expect("clear feature");
    assert!(frontmatter_rows(&conn, file_id).is_empty());

    // The next scan reparses the file and rebuilds its frontmatter.
    scan(&mut conn, &root);
    assert_eq!(
        frontmatter_rows(&conn, file_id),
        vec![("status".to_string(), "done".to_string())]
    );

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

// -----------------------------------------------------------------------
// Link extraction + graph building
// -----------------------------------------------------------------------

#[test]
fn url_scheme_detection_separates_external_links_from_paths() {
    assert!(has_url_scheme("https://example.com"));
    assert!(has_url_scheme("mailto:a@b.com"));
    assert!(has_url_scheme("data:text/plain,x"));
    // A Windows drive is a path, not a URL (single-letter "scheme").
    assert!(!has_url_scheme(r"C:\notes\a.md"));
    assert!(!has_url_scheme("./b.md"));
    assert!(!has_url_scheme("sub/c.md"));
    assert!(!has_url_scheme("#section"));
}

#[test]
fn extracts_markdown_html_and_wiki_links_and_drops_external() {
    let a = Path::new("root").join("notes").join("a.md");
    let content = "[rel](./b.md)\n\
             <a href=\"c.md\">c</a>\n\
             see [[Note D]] and [[Note D#head|alias]]\n\
             [ext](https://example.com)\n\
             [anchor](#top)\n\
             [space](My%20Note.md)\n";
    let links = document_links(content, &a);

    let names: Vec<String> = links.iter().filter_map(|l| l.target_name.clone()).collect();
    assert!(names.contains(&"note d".to_string()));
    // The two `[[Note D...]]` links dedupe to one name target.
    assert_eq!(names.iter().filter(|n| *n == "note d").count(), 1);

    let paths: Vec<String> = links.iter().filter_map(|l| l.target_abs.clone()).collect();
    assert!(paths.iter().any(|p| p.ends_with("b.md")));
    assert!(paths.iter().any(|p| p.ends_with("c.md")));
    // Percent escapes are decoded so the target matches the on-disk name.
    assert!(paths.iter().any(|p| p.ends_with("My Note.md")));
    // The external URL and the pure anchor contribute no link.
    assert!(!paths.iter().any(|p| p.contains("example.com")));
    assert_eq!(links.len(), 4);
}

#[test]
fn xml_links_come_from_target_and_href_attributes() {
    let a = Path::new("root").join("x.xml");
    let content = "<ref target=\"other.xml\">x</ref>\
             <ptr target=\"https://example.com\"/>\
             <a href=\"deep/inner.xml\">y</a>";
    let links = document_links(content, &a);
    let paths: Vec<String> = links.iter().filter_map(|l| l.target_abs.clone()).collect();
    assert!(paths.iter().any(|p| p.ends_with("other.xml")));
    assert!(paths.iter().any(|p| p.ends_with("inner.xml")));
    assert!(!paths.iter().any(|p| p.contains("example.com")));
    assert_eq!(paths.len(), 2);
}

#[test]
fn build_graph_edges_linked_documents_and_indexes_xml_nodes() {
    let dir = unique_dir("graph");
    let root = dir.join("vault");
    write_file(&root.join("a.md"), "# Alpha\n\nlink to [Beta](./b.md)\n");
    // b links back to a with a wiki link (resolved by filename stem).
    write_file(&root.join("b.md"), "# Beta\n\nback to [[a]]\n");
    write_file(
        &root.join("c.xml"),
        "<TEI><teiHeader><fileDesc><titleStmt>\
                <title type=\"mainTitle\" xml:lang=\"en\">Gamma</title>\
             </titleStmt></fileDesc></teiHeader>\
             <text><body><p>hello</p></body></text></TEI>",
    );
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    let graph = build_graph(&conn, &GraphRequest::default()).expect("graph builds");
    // All three documents — including the TEI XML — are nodes.
    assert_eq!(graph.nodes.len(), 3);
    assert!(graph.nodes.iter().any(|n| n.label == "Gamma"));
    assert!(!graph.truncated);

    // The forward Markdown link and the backward wiki link collapse to one
    // undirected edge between a.md and b.md; c.xml stays an isolated node.
    assert_eq!(graph.edges.len(), 1);
    let edge = &graph.edges[0];
    let ends = [edge.source.as_str(), edge.target.as_str()];
    assert!(ends.iter().any(|p| p.ends_with("a.md")));
    assert!(ends.iter().any(|p| p.ends_with("b.md")));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn build_graph_focus_scope_keeps_seed_and_its_neighbors() {
    let dir = unique_dir("graph-focus");
    let root = dir.join("vault");
    write_file(&root.join("a.md"), "# Alpha\n\nlink to [Beta](./b.md)\n");
    write_file(&root.join("b.md"), "# Beta\n\nback to [[a]]\n");
    write_file(&root.join("c.md"), "# Gamma\n\nno links here\n");
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    // The full graph gives us a.md's stored path to seed the focus request.
    let all = build_graph(&conn, &GraphRequest::default()).expect("graph builds");
    let a_path = all
        .nodes
        .iter()
        .find(|n| n.path.ends_with("a.md"))
        .map(|n| n.path.clone())
        .expect("a.md is a node");

    // Focused on a.md: the slice is a plus its one neighbor b, never the
    // unlinked c.
    let focus = build_graph(
        &conn,
        &GraphRequest {
            focus: Some(vec![a_path]),
            limit: None,
        },
    )
    .expect("focus graph builds");
    assert!(!focus.truncated);
    assert_eq!(focus.nodes.len(), 2);
    assert!(focus.nodes.iter().any(|n| n.path.ends_with("a.md")));
    assert!(focus.nodes.iter().any(|n| n.path.ends_with("b.md")));
    assert!(!focus.nodes.iter().any(|n| n.path.ends_with("c.md")));

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn build_graph_capped_scope_keeps_densest_and_flags_truncated() {
    let dir = unique_dir("graph-capped");
    let root = dir.join("vault");
    // hub links to two leaves, so hub has degree 2 and each leaf degree 1.
    write_file(
        &root.join("hub.md"),
        "# Hub\n\n[one](./one.md) and [two](./two.md)\n",
    );
    write_file(&root.join("one.md"), "# One\n");
    write_file(&root.join("two.md"), "# Two\n");
    let mut conn = open_db(&dir).expect("db opens");
    scan(&mut conn, &root);

    // Cap at 2: the densest documents win (hub, then a leaf) and the result
    // is flagged partial.
    let capped = build_graph(
        &conn,
        &GraphRequest {
            focus: None,
            limit: Some(2),
        },
    )
    .expect("capped graph builds");
    assert!(capped.truncated);
    assert_eq!(capped.nodes.len(), 2);
    assert!(capped.nodes.iter().any(|n| n.path.ends_with("hub.md")));

    // A limit larger than the library drops nothing and is not flagged.
    let uncapped = build_graph(
        &conn,
        &GraphRequest {
            focus: None,
            limit: Some(10),
        },
    )
    .expect("graph builds");
    assert!(!uncapped.truncated);
    assert_eq!(uncapped.nodes.len(), 3);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Vaults
// ---------------------------------------------------------------------------

#[test]
fn a_vault_is_a_row_and_writes_nothing_into_the_folder() {
    let dir = unique_dir("vault-add");
    let root = dir.join("dharma");
    write_file(&root.join("note.md"), "# Note\n");
    let before: Vec<String> = std::fs::read_dir(&root)
        .expect("folder read")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    let conn = open_db(&dir).expect("db opens");

    let vault = add_vault(&conn, &root, &default_vault_name(&root)).expect("vault added");
    assert_eq!(vault.name, "dharma");
    assert_eq!(vault.root_path, path_to_string(&root));
    assert!(vault.id > 0);

    // The whole point: adding a vault leaves the user's folder alone. No marker,
    // no dotfile, nothing.
    let after: Vec<String> = std::fs::read_dir(&root)
        .expect("folder read")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(before, after);

    // Adding the same folder again is the same vault, not a second one.
    let again = add_vault(&conn, &root, "Renamed").expect("vault re-added");
    assert_eq!(again, vault);
    assert_eq!(list_vaults(&conn).expect("listed").len(), 1);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_active_vault_survives_a_reopen_and_falls_back_to_the_whole_library() {
    let dir = unique_dir("vault-active");
    let one = dir.join("one");
    let two = dir.join("two");
    std::fs::create_dir_all(&one).expect("folder created");
    std::fs::create_dir_all(&two).expect("folder created");
    let conn = open_db(&dir).expect("db opens");

    // Nothing chosen yet is the whole library, which is a real answer, not an
    // error state.
    assert_eq!(active_vault_id(&conn), 0);
    assert!(find_vault(&conn, 0).expect("lookup").is_none());

    // Two vaults may share a name; they are told apart by id.
    let first = add_vault(&conn, &one, "Library").expect("added");
    let second = add_vault(&conn, &two, "Library").expect("added");
    assert_ne!(first.id, second.id);
    set_active_vault_id(&conn, second.id).expect("active saved");
    assert_eq!(active_vault_id(&conn), second.id);
    assert_eq!(
        find_vault(&conn, second.id)
            .expect("lookup")
            .map(|vault| vault.root_path),
        Some(path_to_string(&two))
    );

    // It is in the database, so the next launch reads the same answer back.
    drop(conn);
    let conn = open_db(&dir).expect("db reopens");
    assert_eq!(active_vault_id(&conn), second.id);

    // Back to the whole library.
    set_active_vault_id(&conn, 0).expect("active cleared");
    assert_eq!(active_vault_id(&conn), 0);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn migration_5_lands_on_an_index_that_predates_vaults() {
    let dir = unique_dir("vault-migrate");
    let conn = open_db(&dir).expect("db opens");
    let version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .expect("version read");
    assert_eq!(version, SCHEMA_VERSION);

    // Reopening an existing database must not try to create the tables twice —
    // this is the path every already-installed copy takes.
    drop(conn);
    let conn = open_db(&dir).expect("db reopens");
    assert!(list_vaults(&conn).expect("listed").is_empty());

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_vault_can_be_renamed_repointed_and_removed() {
    let dir = unique_dir("vault-edit");
    let wrong = dir.join("emptyguru").join("site");
    let right = dir.join("emptyguru");
    let other = dir.join("elsewhere");
    std::fs::create_dir_all(&wrong).expect("folder created");
    std::fs::create_dir_all(&other).expect("folder created");
    let conn = open_db(&dir).expect("db opens");

    // The wrong folder picked.
    let vault = add_vault(&conn, &wrong, &default_vault_name(&wrong)).expect("added");
    assert_eq!(vault.name, "site");

    // Relabelling touches nothing but the label.
    rename_vault(&conn, vault.id, "  Empty Guru  ").expect("renamed");
    assert_eq!(
        find_vault(&conn, vault.id).expect("lookup").unwrap().name,
        "Empty Guru"
    );
    // An empty name is not a name; the old one stands.
    rename_vault(&conn, vault.id, "   ").expect("blank ignored");
    assert_eq!(
        find_vault(&conn, vault.id).expect("lookup").unwrap().name,
        "Empty Guru"
    );

    // Re-pointing keeps the row — same id, same name, new folder.
    set_vault_root(&conn, vault.id, &right).expect("re-pointed");
    let moved = find_vault(&conn, vault.id).expect("lookup").unwrap();
    assert_eq!(moved.id, vault.id);
    assert_eq!(moved.name, "Empty Guru");
    assert_eq!(moved.root_path, path_to_string(&right));
    assert_eq!(list_vaults(&conn).expect("listed").len(), 1);

    // Two rows for one folder would be two names for the same place.
    let second = add_vault(&conn, &other, "Elsewhere").expect("added");
    assert!(set_vault_root(&conn, second.id, &right).is_err());
    assert_eq!(
        find_vault(&conn, second.id)
            .expect("lookup")
            .unwrap()
            .root_path,
        path_to_string(&other)
    );

    // Removing drops the row and leaves the folder standing.
    remove_vault(&conn, second.id).expect("removed");
    assert!(find_vault(&conn, second.id).expect("lookup").is_none());
    assert!(other.is_dir());
    assert_eq!(list_vaults(&conn).expect("listed").len(), 1);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}
