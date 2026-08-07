//! What is left of the store: the vault registry, the schema, and the two parsers the renderer and the corpus share.

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
    // The crawl's manifest of the whole computer is not built any more, so it is never created in the first place.
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
    // Stand in for an installed copy: a database carrying the crawl's tables and recorded as being at migration 4.
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

    // The whole point: adding a vault leaves the user's folder alone. No marker, no dotfile, nothing.
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

    // Nothing chosen yet is the whole library, which is a real answer, not an error state.
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
    assert_eq!(block.offset, "---\n".len());
    // A `---` deeper in the document is body content, not a fence.
    assert_eq!(
        extract_frontmatter("# Heading\n\nintro\n\n---\n\nmore\n"),
        None
    );
    assert_eq!(extract_frontmatter("---\ntitle: Hi\nno close\n"), None);
    // A BOM before the fence is still a fence, and the body starts past it.
    let marked = extract_frontmatter("\u{feff}---\ntitle: Hi\n---\nbody\n").expect("block");
    assert_eq!(marked.offset, "\u{feff}---\n".len());
    // Sliced rather than reassembled, so a CRLF document keeps every byte and every offset stays the file's.
    let crlf = extract_frontmatter("---\r\ntitle: Hi\r\n---\r\nbody\r\n").expect("block");
    assert_eq!(crlf.body, "title: Hi\r\n");

    let block = extract_frontmatter(
        "---\ntitle: Notes\ntags: [one, two]\nauthors:\n  - Ada\n  - Grace\n---\n",
    )
    .expect("block");
    let parsed = parse_frontmatter(&block);
    assert!(
        parsed.refusals.is_empty(),
        "refusals: {:?}",
        parsed.refusals
    );
    let pairs: Vec<(String, Vec<String>)> = parsed
        .fields
        .iter()
        .map(|field| {
            (
                field.key.clone(),
                field.values.iter().map(|v| v.text.clone()).collect(),
            )
        })
        .collect();
    // Both list forms are one field holding items now, not one field per item.
    assert_eq!(
        pairs,
        vec![
            ("title".to_string(), vec!["Notes".to_string()]),
            (
                "tags".to_string(),
                vec!["one".to_string(), "two".to_string()]
            ),
            (
                "authors".to_string(),
                vec!["Ada".to_string(), "Grace".to_string()]
            ),
        ]
    );

    // A block nothing parses out of is no fields and a refusal per line — the same answer the old error variant gave, without a second type to carry it.
    let garbage = extract_frontmatter("---\nthis is not yaml at all\n---\n").expect("block");
    let parsed = parse_frontmatter(&garbage);
    assert!(parsed.fields.is_empty());
    assert_eq!(parsed.refusals.len(), 1);
    assert_eq!(parsed.refusals[0].reason, RefusalReason::NoColon);
}

#[test]
fn a_frontmatter_key_keeps_its_case_and_is_matched_either_way() {
    let fields = document_fields("---\nAuthor: Ada\n---\n");
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].key, "Author");
    assert!(fields[0].key_is("author"));
    assert!(fields[0].key_is("AUTHOR"));
    // The alias reader compares through the same helper, so a capitalized key still answers.
    assert_eq!(
        aliases_from(
            &document_fields("---\nAliases: [Mozart]\n---\n"),
            "Wolfgang"
        ),
        vec!["Mozart"]
    );
}

#[test]
fn a_nested_frontmatter_field_is_refused_rather_than_promoted() {
    let parsed = parse_frontmatter(
        &extract_frontmatter("---\nperson:\n  name: Ada\n  born: 1815\n---\n").expect("block"),
    );
    // `name` and `born` used to arrive as top-level fields nobody typed.
    assert!(parsed.fields.is_empty(), "fields: {:?}", parsed.fields);
    assert_eq!(parsed.refusals.len(), 2);
    assert!(parsed
        .refusals
        .iter()
        .all(|refusal| refusal.reason == RefusalReason::Nested));
    assert_eq!(parsed.refusals[0].line, "name: Ada");
}

#[test]
fn the_first_of_a_duplicate_frontmatter_key_wins_and_the_rest_are_reported() {
    let parsed = parse_frontmatter(
        &extract_frontmatter("---\ntitle: First\ntitle: Second\nTITLE: Third\n---\n")
            .expect("block"),
    );
    assert_eq!(parsed.fields.len(), 1);
    assert_eq!(parsed.fields[0].text(), "First");
    assert_eq!(parsed.refusals.len(), 2);
    assert!(parsed
        .refusals
        .iter()
        .all(|refusal| refusal.reason == RefusalReason::Duplicate));

    // A list under the losing key attaches to nothing rather than joining the first one.
    let parsed = parse_frontmatter(
        &extract_frontmatter("---\naliases:\n  - A\naliases:\n  - B\n---\n").expect("block"),
    );
    let values: Vec<&str> = parsed.fields.iter().map(|field| field.text()).collect();
    assert_eq!(values, vec!["A"]);
    assert_eq!(
        parsed
            .refusals
            .iter()
            .map(|refusal| refusal.reason)
            .collect::<Vec<_>>(),
        vec![RefusalReason::Duplicate, RefusalReason::OrphanItem]
    );
}

#[test]
fn every_frontmatter_field_points_at_its_own_bytes() {
    let text = "---\nversion: \"1.0\"\ntags: [one, two]\nauthors:\n  - Ada\ntime: 12:30\n---\n";
    let fields = document_fields(text);
    let at = |key: &str| {
        fields
            .iter()
            .find(|field| field.key_is(key))
            .unwrap_or_else(|| panic!("no {key} field"))
    };
    let slice = |range: &std::ops::Range<usize>| &text[range.clone()];

    let version = at("version");
    assert_eq!(slice(&version.key_range), "version");
    // The range covers the value as written, so putting the quotes back needs no guessing.
    assert_eq!(slice(&version.values[0].range), "\"1.0\"");
    assert_eq!(version.text(), "1.0");
    assert!(version.values[0].quoted);

    // Every item of a list has its own range, under the one key that declared them.
    let tags: Vec<&str> = at("tags")
        .values
        .iter()
        .map(|value| slice(&value.range))
        .collect();
    assert_eq!(tags, vec!["one", "two"]);

    let authors = at("authors");
    assert_eq!(slice(&authors.key_range), "authors");
    assert_eq!(slice(&authors.values[0].range), "Ada");

    // Split on the first colon only, so the value keeps the rest of them.
    let time = at("time");
    assert_eq!(slice(&time.values[0].range), "12:30");
    assert!(!time.values[0].quoted);
}

#[test]
fn a_frontmatter_field_knows_which_of_the_six_types_it_is() {
    let kind = |line: &str| {
        document_fields(&format!("---\n{line}\n---\n"))
            .first()
            .map(|field| field.kind)
            .expect("one field")
    };

    assert_eq!(kind("note: hello"), FieldType::Text);
    assert_eq!(kind("done: true"), FieldType::Checkbox);
    assert_eq!(kind("done: FALSE"), FieldType::Checkbox);
    assert_eq!(kind("count: 42"), FieldType::Number);
    assert_eq!(kind("ratio: -1.5e3"), FieldType::Number);
    assert_eq!(kind("due: 2026-08-10"), FieldType::Date);
    // All four shapes Obsidian accepts: `T` or a space, seconds or not. Reading only the first would type half a real vault as text.
    assert_eq!(kind("at: 2026-08-10T09:30:00"), FieldType::DateTime);
    assert_eq!(kind("at: 2026-08-10 09:30:00"), FieldType::DateTime);
    assert_eq!(kind("at: 2026-08-10T09:30"), FieldType::DateTime);
    assert_eq!(kind("at: 2026-08-10 09:30"), FieldType::DateTime);
    assert_eq!(kind("crew: [Ada, Grace]"), FieldType::List);

    // Quoting is the file saying "text", so it wins over every shape below it.
    assert_eq!(kind("version: 1.0"), FieldType::Number);
    assert_eq!(kind("version: \"1.0\""), FieldType::Text);
    assert_eq!(kind("due: \"2026-08-10\""), FieldType::Text);
    assert_eq!(kind("done: \"true\""), FieldType::Text);

    // A quoted number keeps every character it was written with.
    let phone = document_fields("---\nphone: \"0123\"\n---\n");
    assert_eq!(phone[0].text(), "0123");
    assert_eq!(phone[0].kind, FieldType::Text);

    // Shaped like a date is not being one, and a word is a word.
    assert_eq!(kind("due: 2026-13-45"), FieldType::Text);
    assert_eq!(kind("due: 2026-02-30"), FieldType::Text);
    assert_eq!(kind("ratio: inf"), FieldType::Text);
    assert_eq!(kind("ratio: NaN"), FieldType::Text);
}

/// The document `splice` produces, or the document unchanged when it produced nothing.
fn spliced(text: &str, splice: Option<FieldSplice>) -> String {
    splice.map_or_else(|| text.to_string(), |splice| splice.applied_to(text))
}

#[test]
fn setting_one_field_leaves_every_other_byte_of_the_block_alone() {
    let text = "---\n# who wrote it\nAuthor: 'Ada'\n\nversion: \"1.0\"\ntags: [one, two]\ncount: 3\n---\n\n# Heading\n";
    // The comment, the blank line, the key's case, the other fields and the body all survive; only the one value moves.
    assert_eq!(
        spliced(text, set_field(text, "count", "4")),
        "---\n# who wrote it\nAuthor: 'Ada'\n\nversion: \"1.0\"\ntags: [one, two]\ncount: 4\n---\n\n# Heading\n"
    );
    // A value that arrived in quotes keeps them, in the mark it was written with — dropping them would retype the field as a number.
    assert_eq!(
        spliced(text, set_field(text, "version", "2.0")),
        text.replace("\"1.0\"", "\"2.0\"")
    );
    assert_eq!(
        spliced(text, set_field(text, "Author", "Grace")),
        text.replace("'Ada'", "'Grace'")
    );
    // The key is matched the way every other reader matches it, and the file's own case is what stays.
    assert_eq!(
        spliced(text, set_field(text, "author", "Grace")),
        text.replace("'Ada'", "'Grace'")
    );
    // One value over a list replaces the list, not its first item.
    assert_eq!(
        spliced(text, set_field(text, "tags", "three")),
        text.replace("[one, two]", "[three]")
    );
    // Nothing to write is nothing spliced.
    assert_eq!(set_field(text, "count", "3"), None);
    // No single-line field can hold a line break.
    assert_eq!(set_field(text, "count", "4\n5"), None);
}

#[test]
fn a_value_is_quoted_only_where_reading_it_back_needs_it() {
    let written = |value: &str| {
        let text = "---\nnote: old\n---\n";
        spliced(&text, set_field(text, "note", value))
            .trim_start_matches("---\nnote: ")
            .trim_end_matches("\n---\n")
            .to_string()
    };
    // Bare where bare reads back, because quoting a value that never needed it rewrites a line nobody asked to change.
    assert_eq!(written("hello"), "hello");
    assert_eq!(written("-1.5"), "-1.5");
    assert_eq!(written("12:30"), "12:30");
    // A colon and a space, a comment mark, or an opener at the front all end the value early otherwise.
    assert_eq!(written("Notes: a start"), "\"Notes: a start\"");
    assert_eq!(written("done # really"), "\"done # really\"");
    assert_eq!(written("[draft]"), "\"[draft]\"");
    assert_eq!(written("- item"), "\"- item\"");
    assert_eq!(written("ends with:"), "\"ends with:\"");
    // The mark the value does not itself hold, so the quoted run does not look closed early.
    assert_eq!(written("#\"quoted\""), "'#\"quoted\"'");
    // And what goes in comes back out.
    for value in ["Notes: a start", "done # really", "[draft]", "#\"quoted\""] {
        let text = "---\nnote: old\n---\n";
        let out = spliced(text, set_field(text, "note", value));
        assert_eq!(
            document_fields(&out)[0].text(),
            value,
            "round trip: {value}"
        );
    }
}

#[test]
fn a_field_the_block_does_not_have_is_appended_and_a_missing_block_is_written() {
    let text = "---\ntitle: Notes\n---\n\nbody\n";
    assert_eq!(
        spliced(text, set_field(text, "status", "draft")),
        "---\ntitle: Notes\nstatus: draft\n---\n\nbody\n"
    );
    // A CRLF document keeps its endings, or the one spliced line reads differently from every other.
    let crlf = "---\r\ntitle: Notes\r\n---\r\n\r\nbody\r\n";
    assert_eq!(
        spliced(crlf, set_field(crlf, "status", "draft")),
        "---\r\ntitle: Notes\r\nstatus: draft\r\n---\r\n\r\nbody\r\n"
    );
    // A block with nothing in it still takes a field.
    assert_eq!(
        spliced("---\n---\nbody\n", set_field("---\n---\nbody\n", "a", "b")),
        "---\na: b\n---\nbody\n"
    );
    // The first field on a file that starts with a heading writes the fences and leaves the heading where it was.
    let plain = "# Heading\n\nbody\n";
    assert_eq!(
        spliced(plain, set_field(plain, "title", "Notes")),
        "---\ntitle: Notes\n---\n\n# Heading\n\nbody\n"
    );
    assert_eq!(
        document_fields(&spliced(plain, set_field(plain, "title", "Notes")))[0].text(),
        "Notes"
    );
    // Past a byte order mark, so the fences are still the first line.
    let marked = "\u{feff}# Heading\n";
    assert!(spliced(marked, set_field(marked, "title", "Notes")).starts_with("\u{feff}---\n"));
    // A key that opened a list and got no items is neither a field nor a refusal, so setting it writes onto that line instead of adding a second one the parser would refuse.
    let empty = "---\ntags:\ntitle: Notes\n---\n";
    assert_eq!(
        spliced(empty, set_field(empty, "tags", "one")),
        "---\ntags: one\ntitle: Notes\n---\n"
    );
    // A key the file opened and put nothing in is a field with no value range of its own, so the rest of its line is what the value goes over.
    let brackets = "---\ntags: []\ntitle: Notes\n---\n";
    assert_eq!(
        spliced(brackets, set_field(brackets, "tags", "one")),
        "---\ntags: one\ntitle: Notes\n---\n"
    );
}

#[test]
fn a_splice_only_lands_on_bytes_the_parser_reported() {
    // The first of a repeated key is the field, so the first is what changes and the loser is left exactly as written.
    let twice = "---\ntitle: First\ntitle: Second\n---\n";
    assert_eq!(
        spliced(twice, set_field(twice, "title", "Third")),
        "---\ntitle: Third\ntitle: Second\n---\n"
    );
    assert_eq!(
        spliced(twice, remove_field(twice, "title")),
        "---\ntitle: Second\n---\n"
    );

    // A nested line is a refusal, never a field: setting its key appends a real one and leaves the refused line alone, and removing it removes nothing.
    let nested = "---\nperson:\n  name: Ada\n---\n";
    assert_eq!(
        spliced(nested, set_field(nested, "name", "Grace")),
        "---\nperson:\n  name: Ada\nname: Grace\n---\n"
    );
    assert_eq!(remove_field(nested, "name"), None);
    assert_eq!(remove_field("# Heading\n", "title"), None);
}

#[test]
fn removing_a_field_takes_its_line_and_the_items_under_it() {
    let text = "---\ntitle: Notes\nauthors:\n  - Ada\n  - Grace\ncount: 3\n---\n\nbody\n";
    assert_eq!(
        spliced(text, remove_field(text, "authors")),
        "---\ntitle: Notes\ncount: 3\n---\n\nbody\n"
    );
    // An inline list is one line, so one line is what goes.
    let inline = "---\ntags: [one, two]\ncount: 3\n---\n";
    assert_eq!(
        spliced(inline, remove_field(inline, "tags")),
        "---\ncount: 3\n---\n"
    );
    // Taking the last thing in the block takes the fences and the blank line under them, rather than opening the file on an empty pair.
    let only = "---\ntitle: Notes\n---\n\nbody\n";
    assert_eq!(spliced(only, remove_field(only, "title")), "body\n");
    // A comment, or a line the parser refused, is worth keeping the fences for.
    let commented = "---\n# who wrote it\ntitle: Notes\n---\n\nbody\n";
    assert_eq!(
        spliced(commented, remove_field(commented, "title")),
        "---\n# who wrote it\n---\n\nbody\n"
    );
}

#[test]
fn a_list_is_written_back_in_the_form_the_file_wrote_it() {
    // Inline stays inline.
    let inline = "---\ntags: [one, two]\ncount: 3\n---\n";
    assert_eq!(
        spliced(
            inline,
            set_list_field(inline, "tags", &["one", "two", "three"])
        ),
        "---\ntags: [one, two, three]\ncount: 3\n---\n"
    );
    // A block list keeps its own indent, and only the items move.
    let block = "---\nauthors:\n  - Ada\n  - Grace\ncount: 3\n---\n";
    assert_eq!(
        spliced(block, set_list_field(block, "authors", &["Ada", "Bob"])),
        "---\nauthors:\n  - Ada\n  - Bob\ncount: 3\n---\n"
    );
    assert_eq!(
        spliced(block, set_list_field(block, "authors", &["Ada"])),
        "---\nauthors:\n  - Ada\ncount: 3\n---\n"
    );
    // An item carrying a comma cannot go in an inline list at all — the reader splits on every comma in the line — so it is refused rather than written as something that reads back as two. A `- item` list takes it.
    assert_eq!(set_list_field(inline, "tags", &["a, b", "plain"]), None);
    assert_eq!(
        spliced(block, set_list_field(block, "authors", &["Ada, again"])),
        "---\nauthors:\n  - Ada, again\ncount: 3\n---\n"
    );
    assert_eq!(
        document_fields(&spliced(
            block,
            set_list_field(block, "authors", &["Ada, again"])
        ))[0]
            .text(),
        "Ada, again"
    );
    // Emptying it rewrites the whole field: a block list would otherwise keep the dash that opened its first item, and a key with no items is one the parser stops reporting.
    assert_eq!(
        spliced(block, set_list_field(block, "authors", &[])),
        "---\nauthors: []\ncount: 3\n---\n"
    );
    // A key the block does not have arrives as one.
    assert_eq!(
        spliced(inline, set_list_field(inline, "crew", &["Ada"])),
        "---\ntags: [one, two]\ncount: 3\ncrew: [Ada]\n---\n"
    );
    assert_eq!(set_list_field(inline, "tags", &["one", "two"]), None);
    assert_eq!(set_list_field(inline, "tags", &["one\ntwo"]), None);
}

#[test]
fn renaming_a_key_keeps_its_value_and_its_place_in_the_block() {
    let text = "---\ntitle: Notes\nversion: \"1.0\"\n---\n\nbody\n";
    // One splice over the key's own bytes: the value, its quoting and the row's position all stay where they were.
    assert_eq!(
        spliced(text, rename_field(text, "version", "release")),
        "---\ntitle: Notes\nrelease: \"1.0\"\n---\n\nbody\n"
    );
    // Only the case changing is still a change, because the file keeps the case it was written in.
    assert_eq!(
        spliced(text, rename_field(text, "title", "Title")),
        "---\nTitle: Notes\nversion: \"1.0\"\n---\n\nbody\n"
    );
    // A name the block already holds would become a duplicate the parser then refuses, so it is refused here instead.
    assert_eq!(rename_field(text, "version", "title"), None);
    assert_eq!(rename_field(text, "version", "TITLE"), None);
    // A name no key can hold, and a key that is not there.
    assert_eq!(rename_field(text, "version", "a: b"), None);
    assert_eq!(rename_field(text, "version", "  "), None);
    assert_eq!(rename_field(text, "version", "- item"), None);
    assert_eq!(rename_field(text, "missing", "release"), None);
}

#[test]
fn a_list_of_one_is_still_a_list_and_the_documented_properties_never_guess() {
    // The shape before this could not tell these two apart at all.
    let one = document_fields("---\ncrew: [Ada]\n---\n");
    assert_eq!(one[0].kind, FieldType::List);
    assert_eq!(one[0].values.len(), 1);
    let plain = document_fields("---\ncrew: Ada\n---\n");
    assert_eq!(plain[0].kind, FieldType::Text);

    // Obsidian's own frozen table is these three and nothing else, so one note's value never decides them.
    let documented = |line: &str| {
        document_fields(&format!("---\n{line}\n---\n"))
            .first()
            .map(|field| field.kind)
            .expect("one field")
    };
    assert_eq!(documented("tags: one"), FieldType::List);
    assert_eq!(documented("aliases: Mozart"), FieldType::List);
    assert_eq!(documented("cssclasses: wide"), FieldType::List);
    // Matched the way every other key is: case does not change what a property is.
    assert_eq!(documented("Tags: one"), FieldType::List);

    // The Publish properties are not in that table, so they are worked out like anything else — which is what Obsidian does with them too. Forcing them would type a note differently from the app it came from.
    assert_eq!(documented("publish: true"), FieldType::Checkbox);
    assert_eq!(documented("publish: maybe"), FieldType::Text);
    assert_eq!(documented("description: 42"), FieldType::Number);
    assert_eq!(documented("permalink: 2026-08-10"), FieldType::Date);
    assert_eq!(documented("cover: 1.5"), FieldType::Number);
}

#[test]
fn the_vault_s_own_types_and_a_note_s_pin_override_the_value_s_shape() {
    let dir = unique_dir("obsidian-types");
    let vault = dir.join("vault");
    let notes = vault.join("notes");
    std::fs::create_dir_all(vault.join(".obsidian")).expect("config folder");
    std::fs::create_dir_all(&notes).expect("notes folder");
    // The shape Obsidian's own writer produces: the key as the file spelled it, against its widget name. `multitext`, `aliases` and `tags` are all lists here; `file` points at another note and has no type of ours.
    std::fs::write(
        vault.join(".obsidian").join("types.json"),
        r#"{"types":{"Count":"text","note":"multitext","when":"datetime","Ref":"file"}}"#,
    )
    .expect("types written");
    let note = notes.join("deep.md");

    let text = "---\nCount: 42\nnote: one\nwhen: 2026-08-10\nRef: 7\nloose: 1.5\n---\n";
    let block = extract_frontmatter(text).expect("block");
    let mut fields = parse_frontmatter(&block).fields;
    // Found by walking up from the note, so a document several folders deep still finds its vault.
    let vault_types = vault_types_for(&note);
    assert!(!vault_types.is_empty());
    let no_pins = pinned_types(&fields);
    apply_types(&mut fields, &vault_types, &no_pins);
    let kind = |key: &str| {
        fields
            .iter()
            .find(|field| field.key_is(key))
            .map(|field| field.kind)
            .expect("field")
    };
    // The file's word beats the value's shape, and its keys match whatever case either side used.
    assert_eq!(kind("Count"), FieldType::Text);
    assert_eq!(kind("note"), FieldType::List);
    assert_eq!(kind("when"), FieldType::DateTime);
    assert_eq!(kind("Ref"), FieldType::Text);
    // A key the file says nothing about keeps what it worked out for itself.
    assert_eq!(kind("loose"), FieldType::Number);

    // The note's own pin wins over the vault's file.
    let pinned_text =
        "---\nCount: 42\nleaftext-types: [Count=number, when=text, nope=banana]\n---\n";
    let mut fields = parse_frontmatter(&extract_frontmatter(pinned_text).expect("block")).fields;
    let pinned = pinned_types(&fields);
    apply_types(&mut fields, &vault_types, &pinned);
    assert_eq!(fields[0].kind, FieldType::Number);
    // A pin naming a type this app does not have costs that one pin, not the field: two of the three landed.
    assert!(!pinned.is_empty());

    // A document in no vault behaves exactly as it did before any of this.
    let loose = dir.join("loose.md");
    assert!(vault_types_for(&loose).is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn which_folder_holds_the_types_file_is_only_worked_out_once() {
    let dir = unique_dir("obsidian-types-cache");
    let notes = dir.join("a").join("b").join("c");
    std::fs::create_dir_all(&notes).expect("folders");
    let note = notes.join("note.md");

    // Nothing to find yet, which is the answer that gets remembered.
    assert!(vault_types_for(&note).is_empty());

    // Now give it something to find. The walk is what is cached, so this folder's answer does not change until the app restarts — the cost of not paying eight disk checks on every open.
    std::fs::create_dir_all(dir.join(".obsidian")).expect("config folder");
    std::fs::write(
        dir.join(".obsidian").join("types.json"),
        r#"{"types":{"when":"date"}}"#,
    )
    .expect("types written");
    assert!(
        vault_types_for(&note).is_empty(),
        "the walk ran again, so it is not being remembered"
    );

    // A folder nobody has asked about yet does the walk, finds it, and reads the file.
    let sibling = dir.join("a").join("other");
    std::fs::create_dir_all(&sibling).expect("folder");
    assert!(!vault_types_for(&sibling.join("note.md")).is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_alias_cap_counts_aliases_and_not_fields() {
    let claimed: String = (0..40).map(|n| format!("  - Name{n}\n")).collect();
    let fields = document_fields(&format!("---\naliases:\n{claimed}---\n"));
    // One field, forty items: the cap used to count fields, which meant the same number only by accident.
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].values.len(), 40);
    assert_eq!(alias_count(&fields, "Doc"), 40);
    assert_eq!(aliases_from(&fields, "Doc").len(), MAX_ALIASES);
}

#[test]
fn aliases_read_both_list_forms_a_bare_string_and_nothing_at_all() {
    let names = |text: &str, label: &str| aliases_from(&document_fields(text), label);

    // Both list forms, and the scalar form real vaults also contain — the parser already yields one field per item either way, so there is one reader.
    assert_eq!(
        names(
            "---\naliases:\n  - Mozart\n  - W. A. Mozart\n---\n",
            "Wolfgang"
        ),
        vec!["Mozart", "W. A. Mozart"]
    );
    assert_eq!(
        names(
            "---\naliases: [Mozart, \"W. A. Mozart\"]\n---\n",
            "Wolfgang"
        ),
        vec!["Mozart", "W. A. Mozart"]
    );
    assert_eq!(
        names("---\naliases: Mozart\n---\n", "Wolfgang"),
        vec!["Mozart"]
    );

    // No block, no field, an empty item, and a claim on the note's own name.
    assert!(names("# Just a heading\n", "Wolfgang").is_empty());
    assert!(names("---\ntitle: Hi\n---\n", "Wolfgang").is_empty());
    assert!(names("---\naliases: [Wolfgang, wolfgang]\n---\n", "Wolfgang").is_empty());
    // Said twice in different case is one name, because that is how names match.
    assert_eq!(
        names("---\naliases: [Mozart, MOZART]\n---\n", "W"),
        vec!["Mozart"]
    );

    // Thirty-three claimed, thirty-two kept, and the count says how many there were.
    let many: String = (0..33).map(|n| format!("  - name-{n}\n")).collect();
    let text = format!("---\naliases:\n{many}---\n");
    assert_eq!(names(&text, "Many").len(), MAX_ALIASES);
    assert_eq!(alias_count(&document_fields(&text), "Many"), 33);
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
