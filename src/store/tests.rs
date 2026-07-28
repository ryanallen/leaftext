//! What is left of the store: the vault registry, the schema, and the two
//! parsers the renderer and the corpus share.

use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

fn unique_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("leaf-store-{tag}-{nanos}-{n}"));
    std::fs::create_dir_all(&dir).expect("temp dir created");
    dir
}

fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
        params![table],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

#[test]
fn a_fresh_database_holds_the_vaults_and_nothing_of_the_crawl() {
    let dir = unique_dir("fresh");
    let conn = open_db(&dir).expect("db opens");

    for table in ["vaults", "app_state", "schema_migrations"] {
        assert!(table_exists(&conn, table), "missing table {table}");
    }
    // The crawl's manifest of the whole computer is not built any more, so it is
    // never created in the first place.
    for gone in [
        "files",
        "headings",
        "chunks",
        "chunks_fts",
        "frontmatter",
        "links",
        "file_feature_state",
        "scan_roots",
        "scan_runs",
        "scan_run_roots",
    ] {
        assert!(!table_exists(&conn, gone), "crawl table {gone} was created");
    }

    // Reopening runs nothing and breaks nothing.
    drop(conn);
    let conn = open_db(&dir).expect("db reopens");
    assert!(list_vaults(&conn).expect("listed").is_empty());

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_existing_index_has_the_crawl_dropped_out_of_it() {
    let dir = unique_dir("migrate");
    // Stand in for an installed copy: a database carrying the crawl's tables and
    // recorded as being at migration 4.
    {
        let conn = Connection::open(manifest_path(&dir)).expect("db created");
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
             CREATE TABLE scan_roots (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, added_at INTEGER NOT NULL);
             CREATE TABLE files (id INTEGER PRIMARY KEY, abs_path TEXT NOT NULL UNIQUE);
             CREATE TABLE headings (file_id INTEGER NOT NULL, ordinal INTEGER NOT NULL);
             CREATE TABLE chunks (id INTEGER PRIMARY KEY, text TEXT NOT NULL);
             CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id');
             CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
               INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
             END;
             CREATE TABLE frontmatter (file_id INTEGER NOT NULL, key TEXT NOT NULL);
             CREATE TABLE links (from_file_id INTEGER NOT NULL, ordinal INTEGER NOT NULL);
             CREATE TABLE file_feature_state (file_id INTEGER NOT NULL, feature TEXT NOT NULL);
             CREATE TABLE scan_runs (id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL);
             CREATE TABLE scan_run_roots (scan_run_id INTEGER NOT NULL, scan_root_id INTEGER NOT NULL);
             INSERT INTO schema_migrations (version, applied_at) VALUES (1, 0), (2, 0), (3, 0), (4, 0);",
        )
        .expect("crawl schema created");
    }

    let conn = open_db(&dir).expect("db opens and migrates");

    // Everything the crawl owned is gone, triggers and the FTS mirror included.
    for gone in [
        "files",
        "headings",
        "chunks",
        "chunks_fts",
        "chunks_ai",
        "frontmatter",
        "links",
        "file_feature_state",
        "scan_roots",
        "scan_runs",
        "scan_run_roots",
    ] {
        assert!(!table_exists(&conn, gone), "{gone} survived the migration");
    }
    // And the vaults are there, on a database that never had them.
    assert!(table_exists(&conn, "vaults"));
    assert!(table_exists(&conn, "app_state"));
    assert_eq!(active_vault_id(&conn), 0);

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
    std::fs::create_dir_all(&root).expect("folder created");
    std::fs::write(root.join("note.md"), "# Note\n").expect("file written");
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

    set_active_vault_id(&conn, 0).expect("active cleared");
    assert_eq!(active_vault_id(&conn), 0);

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

    // Relabeling touches nothing but the label, and a blank name is not a name.
    rename_vault(&conn, vault.id, "  Empty Guru  ").expect("renamed");
    assert_eq!(
        find_vault(&conn, vault.id).expect("lookup").unwrap().name,
        "Empty Guru"
    );
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

    // Removing drops the row and leaves the folder standing.
    remove_vault(&conn, second.id).expect("removed");
    assert!(find_vault(&conn, second.id).expect("lookup").is_none());
    assert!(other.is_dir());
    assert_eq!(list_vaults(&conn).expect("listed").len(), 1);

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// The parsers, which never needed a database
// ---------------------------------------------------------------------------

#[test]
fn frontmatter_parses_scalars_arrays_and_block_lists() {
    let block = extract_frontmatter("---\ntitle: Hi\n---\n\nbody\n").expect("leading block");
    assert_eq!(block.body, "title: Hi\n");
    // A `---` deeper in the document is body content, not a fence.
    assert_eq!(
        extract_frontmatter("# Heading\n\nintro\n\n---\n\nmore\n"),
        None
    );
    assert_eq!(extract_frontmatter("---\ntitle: Hi\nno close\n"), None);
    // A BOM before the fence is still a fence.
    assert!(extract_frontmatter("\u{feff}---\ntitle: Hi\n---\nbody\n").is_some());

    let block = extract_frontmatter(
        "---\ntitle: Notes\ntags: [one, two]\nauthors:\n  - Ada\n  - Grace\n---\n",
    )
    .expect("block");
    let parsed = parse_frontmatter(&block).expect("parsed");
    let pairs: Vec<(String, String)> = parsed
        .fields
        .iter()
        .map(|field| (field.key.clone(), field.value.clone()))
        .collect();
    assert!(pairs.contains(&("title".to_string(), "Notes".to_string())));
    assert!(pairs.contains(&("tags".to_string(), "one".to_string())));
    assert!(pairs.contains(&("tags".to_string(), "two".to_string())));
    assert!(pairs.contains(&("authors".to_string(), "Ada".to_string())));
    assert!(pairs.contains(&("authors".to_string(), "Grace".to_string())));

    let garbage = extract_frontmatter("---\nthis is not yaml at all\n---\n").expect("block");
    assert_eq!(parse_frontmatter(&garbage), Err(MetadataError::Unparseable));
}

#[test]
fn document_links_finds_markdown_html_and_wiki_targets() {
    let source = PathBuf::from(if cfg!(windows) {
        r"C:\vault\notes\a.md"
    } else {
        "/vault/notes/a.md"
    });
    let links = document_links(
        "[rel](./b.md) [up](../c.md) [[Wiki Note]] <a href=\"d.md\">d</a> [out](https://example.com)\n",
        &source,
    );

    let names: Vec<String> = links.iter().filter_map(|l| l.target_name.clone()).collect();
    assert!(names.contains(&normalize_name_key("Wiki Note")));

    let paths: Vec<String> = links.iter().filter_map(|l| l.target_abs.clone()).collect();
    assert!(paths.iter().any(|p| p.ends_with("b.md")));
    assert!(paths.iter().any(|p| p.ends_with("c.md")));
    assert!(paths.iter().any(|p| p.ends_with("d.md")));
    // An external link is not a document in this vault.
    assert!(!paths.iter().any(|p| p.contains("example.com")));

    // Names match case-insensitively, which is how a wiki link finds its file.
    assert_eq!(normalize_name_key("  Wiki Note "), "wiki note");
}

#[test]
fn a_file_is_owned_by_the_innermost_vault_that_holds_it() {
    let dir = unique_dir("owner");
    let outer = dir.join("dharma");
    let inner = outer.join("emptyguru");
    let other = dir.join("elsewhere");
    // A sibling whose name merely starts with a vault's: it must not be claimed.
    let lookalike = dir.join("dharma-old");
    for folder in [&outer, &inner, &other, &lookalike] {
        std::fs::create_dir_all(folder).expect("folder created");
    }
    let conn = open_db(&dir).expect("db opens");
    let outer_vault = add_vault(&conn, &outer, "Dharma").expect("added");
    let inner_vault = add_vault(&conn, &inner, "Empty Guru").expect("added");
    add_vault(&conn, &other, "Elsewhere").expect("added");

    // Nested: the innermost wins, which is the vault the file actually lives in.
    assert_eq!(
        vault_containing(&conn, &inner.join("site").join("index.md")).map(|v| v.id),
        Some(inner_vault.id)
    );
    // Above the inner one, still inside the outer.
    assert_eq!(
        vault_containing(&conn, &outer.join("notes.md")).map(|v| v.id),
        Some(outer_vault.id)
    );
    // A prefix is not a parent.
    assert!(vault_containing(&conn, &lookalike.join("stale.md")).is_none());
    // Nothing owns a file outside every vault: that is the whole library.
    assert!(vault_containing(&conn, &dir.join("loose.md")).is_none());

    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}
