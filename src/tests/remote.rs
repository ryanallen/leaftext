//! Vaults whose files were copied down rather than pointed at.

use super::*;

use crate::remote::{
    fill_mirror, remove_vault_mirror, vault_mirror_dir, FolderSource, RemoteChanges, RemoteEntry,
    RemoteEntryKind, RemoteError, RemoteResult, RemoteSource, POINTER_SUFFIX,
};
use crate::remote::{push_document, refresh_mirror, PushOutcome};
use crate::store::{
    add_vault, list_remote_files, open_db, record_remote_file, GraphRequest, VaultKind,
};
use crate::VaultCorpus;

fn remote_dir(tag: &str) -> PathBuf {
    scratch_dir(&format!("remote-{tag}"))
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent created");
    }
    fs::write(path, contents).expect("file written");
}

/// Every file the mirror holds, named by its place inside it, in one spelling and one order.
fn mirrored(root: &Path) -> Vec<String> {
    fn walk(dir: &Path, root: &Path, found: &mut Vec<String>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, root, found);
            } else {
                found.push(
                    path.strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }
    let mut found = Vec::new();
    walk(root, root, &mut found);
    found.sort();
    found
}

#[test]
fn a_vault_rooted_at_a_mirror_reads_exactly_as_a_folder_vault_does() {
    let dir = remote_dir("mirror-reads");
    let source_root = dir.join("source");
    // Two documents that know about each other, so the map has something to draw, plus a folder under them — the mirror has to arrive with the shape intact, not flattened.
    write(
        &source_root.join("index.md"),
        "# Index\n\nStart at [the guide](notes/guide.md).\n",
    );
    write(
        &source_root.join("notes/guide.md"),
        "# Guide\n\nBack to [the index](../index.md).\n",
    );
    write(&source_root.join("notes/config.yaml"), "name: guide\n");

    let mirror = vault_mirror_dir(&dir, 7);
    let report = fill_mirror(&FolderSource::new(&source_root), "", &mirror, None).expect("filled");
    assert_eq!(report.copied, 3);
    assert_eq!(report.skipped, 0);

    // The folder the app owns holds the same documents, in the same shape.
    assert_eq!(
        mirrored(&mirror),
        vec![
            "index.md".to_string(),
            "notes/config.yaml".to_string(),
            "notes/guide.md".to_string(),
        ]
    );

    // And the three readers that make a vault worth having read it without being told any of this — they were handed a path, which is the whole point of copying the files down.
    let listing = read_folder_listing(Some(&mirror), "");
    let names: Vec<String> = listing
        .entries
        .iter()
        .map(|node| node.name.clone())
        .collect();
    assert!(names.contains(&"index.md".to_string()), "{names:?}");
    assert!(names.contains(&"notes".to_string()), "{names:?}");

    let corpus = VaultCorpus::read(&mirror);
    assert_eq!(corpus.documents.len(), 3);

    let graph = corpus.graph(&GraphRequest::default());
    let mut labels: Vec<String> = graph.nodes.iter().map(|node| node.label.clone()).collect();
    labels.sort();
    assert_eq!(labels, vec!["config", "guide", "index"]);
    // The link written between the two documents survived the copy, which it would not have if the mirror had been flattened.
    assert!(
        graph.edges.iter().any(|edge| {
            let ends = [edge.source.as_str(), edge.target.as_str()];
            ends.iter().any(|end| end.ends_with("index.md"))
                && ends.iter().any(|end| end.ends_with("guide.md"))
        }),
        "the index and the guide are not joined: {:?}",
        graph.edges
    );

    // Forgetting the vault leaves nothing in the app's data folder for a vault nobody has.
    remove_vault_mirror(&dir, 7).expect("mirror removed");
    assert!(!mirror.exists());
    // And a vault that never had one is not a failure — every removal calls this, not only the remote ones.
    remove_vault_mirror(&dir, 7).expect("removing a mirror that was never made is fine");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_file_the_app_cannot_open_is_skipped_rather_than_copied() {
    let dir = remote_dir("mirror-skips");
    let source_root = dir.join("source");
    write(&source_root.join("note.md"), "# Note\n");
    write(&source_root.join("data.json"), "{}\n");
    write(&source_root.join("mail.eml"), "Subject: Hi\n\nBody\n");
    // A mirror is not a backup. Pulling these onto somebody's disk to then not open them is the crawl mistake in another costume.
    write(&source_root.join("holiday.mp4"), "not really a film");
    write(&source_root.join("archive.zip"), "not really a zip");
    write(
        &source_root.join("notes"),
        "a file with no extension at all",
    );

    let mirror = dir.join("mirror");
    let report = fill_mirror(&FolderSource::new(&source_root), "", &mirror, None).expect("filled");

    assert_eq!(
        mirrored(&mirror),
        vec![
            "data.json".to_string(),
            "mail.eml".to_string(),
            "note.md".to_string(),
        ]
    );
    assert_eq!(report.copied, 3);
    assert_eq!(report.skipped, 3);

    // What may come down is the one format table and never a second list, so a format added there arrives here by existing.
    for format in DocumentFormat::ALL
        .into_iter()
        .filter(|format| *format != DocumentFormat::Code)
    {
        let extension = format.extensions()[0];
        write(&source_root.join(format!("sample.{extension}")), "x");
    }
    let second = dir.join("mirror-again");
    let report = fill_mirror(&FolderSource::new(&source_root), "", &second, None).expect("filled");
    assert_eq!(report.copied, 3 + DocumentFormat::ALL.len() - 1);

    let _ = fs::remove_dir_all(&dir);
}

/// A source whose documents have no bytes at all — a page on a service rather than a file. There is no such thing in a folder on this disk, so the shape is stood up here rather than pretended at through [`FolderSource`].
struct BodilessSource;

impl RemoteSource for BodilessSource {
    fn source_name(&self) -> &str {
        "notebook"
    }

    fn list(&self, folder: &str) -> RemoteResult<Vec<RemoteEntry>> {
        if !folder.is_empty() {
            return Ok(Vec::new());
        }
        Ok(vec![
            RemoteEntry {
                id: "page-1".to_string(),
                name: "Meeting notes".to_string(),
                kind: RemoteEntryKind::Document,
                version: Some("3".to_string()),
                size: None,
            },
            // A name that would climb out of the folder the app owns, which is the one thing a source must never be able to do.
            RemoteEntry {
                id: "page-2".to_string(),
                name: "../escaped".to_string(),
                kind: RemoteEntryKind::Document,
                version: None,
                size: None,
            },
        ])
    }

    fn fetch(&self, _id: &str, _into: &Path) -> RemoteResult<()> {
        Err(RemoteError::Unsupported("hand over bytes"))
    }
}

#[test]
fn a_document_with_no_bytes_becomes_a_pointer_and_a_climbing_name_is_refused() {
    let dir = remote_dir("pointer");
    let mirror = dir.join("mirror");
    let report =
        fill_mirror(&BodilessSource, "", &mirror, Some("ryan@example.com")).expect("filled");

    assert_eq!(report.pointers, 1);
    assert_eq!(report.copied, 0);
    assert_eq!(report.refused_names, 1);

    // One pointer, named after the document, and nothing written outside the folder the app owns.
    assert_eq!(
        mirrored(&mirror),
        vec![format!("Meeting notes{POINTER_SUFFIX}")]
    );
    assert!(!dir.join("escaped").exists());
    assert!(!dir.join(format!("escaped{POINTER_SUFFIX}")).exists());

    // It names where to go and get the live thing: the source, its own id for it, and whose account it is under.
    let text = fs::read_to_string(mirror.join(format!("Meeting notes{POINTER_SUFFIX}")))
        .expect("pointer read");
    let pointer: serde_json::Value = serde_json::from_str(&text).expect("pointer parses");
    assert_eq!(pointer["source"], "notebook");
    assert_eq!(pointer["id"], "page-1");
    assert_eq!(pointer["account"], "ryan@example.com");
    // Three fields and no fourth: what a pointer carries is what the loader will be handed, and a field nothing writes is one somebody would read as meaningful.
    assert_eq!(pointer.as_object().expect("an object").len(), 3);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_source_that_cannot_do_something_says_so_rather_than_failing_at_it() {
    let dir = remote_dir("unsupported");
    let source = FolderSource::new(&dir);

    // A folder on this disk has no change feed: it cannot say what moved since a token, only what is there now. The interface hides what a source has not got, because a control that always fails is worse than no control.
    assert!(matches!(
        source.changes(None),
        Err(RemoteError::Unsupported(_))
    ));
    // And a source with no bytes to hand over says so about both halves rather than failing at them.
    assert!(matches!(
        BodilessSource.fetch("page-1", &dir.join("out.md")),
        Err(RemoteError::Unsupported(_))
    ));
    assert!(matches!(
        BodilessSource.push(&dir.join("out.md"), "page-1", None),
        Err(RemoteError::Unsupported(_))
    ));

    // An id this source never handed out does not become a way out of the folder it was rooted at.
    assert!(source
        .fetch("../../secrets.md", &dir.join("out.md"))
        .is_err());
    assert!(source.list("..").is_err());

    let _ = fs::remove_dir_all(&dir);
}

/// A source that answers "what moved" from a script, so a rename can be put through the refresh exactly as a service would report one: the same id, a different name.
struct ScriptedSource {
    root: PathBuf,
    changes: RemoteChanges,
}

impl RemoteSource for ScriptedSource {
    fn source_name(&self) -> &str {
        "scripted"
    }

    fn list(&self, _folder: &str) -> RemoteResult<Vec<RemoteEntry>> {
        Ok(Vec::new())
    }

    fn fetch(&self, id: &str, into: &Path) -> RemoteResult<()> {
        // A service's id says nothing about where the bytes are; the script knows which file each id stands for, the way a real source's own API does.
        let name = self
            .changes
            .changed
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.name.clone())
            .ok_or_else(|| RemoteError::Failed(format!("no entry called {id}")))?;
        FolderSource::new(&self.root).fetch(&name, into)
    }

    fn changes(&self, _token: Option<&str>) -> RemoteResult<RemoteChanges> {
        Ok(self.changes.clone())
    }
}

#[test]
fn a_rename_upstream_moves_one_entry_rather_than_creating_a_second() {
    let dir = remote_dir("rename");
    let source_root = dir.join("source");
    write(&source_root.join("draft.md"), "# Draft\n\nThe body.\n");
    let mirror = dir.join("mirror");
    let conn = open_db(&dir).expect("db opens");
    let vault = add_vault(&conn, &mirror, "Remote", VaultKind::Folder).expect("added");

    // First pass: the document arrives.
    let first = ScriptedSource {
        root: source_root.clone(),
        changes: RemoteChanges {
            changed: vec![RemoteEntry {
                id: "doc-1".to_string(),
                name: "draft.md".to_string(),
                kind: RemoteEntryKind::File,
                version: Some("v1".to_string()),
                size: None,
            }],
            removed: Vec::new(),
            next_token: Some("cursor-1".to_string()),
        },
    };
    let report = refresh_mirror(&first, &conn, vault.id, &mirror, None).expect("first pass");
    assert_eq!(report.updated, 1);
    assert_eq!(report.next_token.as_deref(), Some("cursor-1"));
    assert_eq!(mirrored(&mirror), vec!["draft.md".to_string()]);

    // Renamed upstream: the same id, a different name, and the bytes untouched.
    std::fs::rename(source_root.join("draft.md"), source_root.join("final.md")).expect("renamed");
    let second = ScriptedSource {
        root: source_root.clone(),
        changes: RemoteChanges {
            changed: vec![RemoteEntry {
                id: "doc-1".to_string(),
                name: "final.md".to_string(),
                kind: RemoteEntryKind::File,
                version: Some("v1".to_string()),
                size: None,
            }],
            removed: Vec::new(),
            next_token: Some("cursor-2".to_string()),
        },
    };
    let report =
        refresh_mirror(&second, &conn, vault.id, &mirror, Some("cursor-1")).expect("second pass");

    // One file, under its new name. Matching on the name instead would have left the old one lying beside it, and the map would draw a note joined to its own ghost.
    assert_eq!(report.moved, 1);
    assert_eq!(mirrored(&mirror), vec!["final.md".to_string()]);
    // And one row, moved rather than doubled — the id is the identity.
    let held = list_remote_files(&conn, vault.id).expect("listed");
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].remote_id, "doc-1");
    assert!(held[0].local_path.ends_with("final.md"));
    // The stamp did not move, so the bytes were not fetched again just because the name did.
    assert_eq!(report.updated, 0);
    assert_eq!(held[0].version.as_deref(), Some("v1"));

    // A document the source no longer has goes out of the mirror with its row.
    let third = ScriptedSource {
        root: source_root,
        changes: RemoteChanges {
            changed: Vec::new(),
            removed: vec!["doc-1".to_string()],
            next_token: Some("cursor-3".to_string()),
        },
    };
    let report =
        refresh_mirror(&third, &conn, vault.id, &mirror, Some("cursor-2")).expect("third pass");
    assert_eq!(report.removed, 1);
    assert!(mirrored(&mirror).is_empty());
    assert!(list_remote_files(&conn, vault.id)
        .expect("listed")
        .is_empty());

    drop(conn);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_source_that_moved_first_makes_the_write_fail_rather_than_overwrite() {
    let dir = remote_dir("push-conflict");
    let source_root = dir.join("source");
    write(
        &source_root.join("shared.md"),
        "# Shared\n\nWhat was there.\n",
    );
    let mirror = dir.join("mirror");
    let conn = open_db(&dir).expect("db opens");
    let vault = add_vault(&conn, &mirror, "Remote", VaultKind::Folder).expect("added");

    let source = FolderSource::new(&source_root);
    let local = mirror.join("shared.md");
    source.fetch("shared.md", &local).expect("copied down");
    let read_version = source.list("").expect("listed")[0].version.clone();
    record_remote_file(
        &conn,
        vault.id,
        "shared.md",
        &local.to_string_lossy(),
        read_version.as_deref(),
    )
    .expect("recorded");

    // Nothing has moved: the document goes back, and the source now holds the new words.
    write(&local, "# Shared\n\nWhat I typed.\n");
    match push_document(&source, &conn, vault.id, &local).expect("pushed") {
        // A push answers with the version the source now holds, which two writes inside one tick of the file clock can leave equal to the one read.
        PushOutcome::Sent(_) => {}
        other => panic!("the push did not land: {other:?}"),
    }
    assert_eq!(
        fs::read_to_string(source_root.join("shared.md")).expect("read"),
        "# Shared\n\nWhat I typed.\n"
    );

    // Now somebody else moves it first — the stamp the vault holds is no longer the stamp the source has.
    write(
        &source_root.join("shared.md"),
        "# Shared\n\nWhat somebody else typed.\n",
    );
    record_remote_file(
        &conn,
        vault.id,
        "shared.md",
        &local.to_string_lossy(),
        Some("a-version-nobody-has"),
    )
    .expect("recorded");
    write(&local, "# Shared\n\nWhat I typed after that.\n");

    let outcome = push_document(&source, &conn, vault.id, &local).expect("answered");
    assert_eq!(outcome, PushOutcome::Refused);

    // Neither copy was lost. Theirs is untouched, because a push that would overwrite somebody is refused before a byte is written.
    assert_eq!(
        fs::read_to_string(source_root.join("shared.md")).expect("read"),
        "# Shared\n\nWhat somebody else typed.\n"
    );
    // And the version the vault holds is the one it read, which is what lets the next refresh see the difference and offer theirs.
    let held = list_remote_files(&conn, vault.id).expect("listed");
    assert_eq!(held[0].version.as_deref(), Some("a-version-nobody-has"));

    drop(conn);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_failed_push_leaves_the_local_file_exactly_as_typed() {
    let dir = remote_dir("push-keeps-local");
    let source_root = dir.join("source");
    write(&source_root.join("note.md"), "# Note\n\nTheirs.\n");
    let mirror = dir.join("mirror");
    let conn = open_db(&dir).expect("db opens");
    let vault = add_vault(&conn, &mirror, "Remote", VaultKind::Folder).expect("added");

    let local = mirror.join("note.md");
    let typed = "# Note\n\nEvery word of this has to survive.\n";
    write(&local, typed);
    record_remote_file(
        &conn,
        vault.id,
        "note.md",
        &local.to_string_lossy(),
        Some("a-version-nobody-has"),
    )
    .expect("recorded");

    // Refused because somebody moved first.
    assert_eq!(
        push_document(&FolderSource::new(&source_root), &conn, vault.id, &local).expect("answered"),
        PushOutcome::Refused
    );
    assert_eq!(fs::read_to_string(&local).expect("read"), typed);

    // And failed outright, which is what a source that will not take a document back looks like. The bytes were on this machine before any of this ran, which is the whole guarantee.
    assert!(push_document(&BodilessSource, &conn, vault.id, &local).is_err());
    assert_eq!(fs::read_to_string(&local).expect("read"), typed);

    // A document no mirror is tracking — every save in a folder vault — is not a failure and sends nothing.
    let untracked = mirror.join("mine.md");
    write(&untracked, "# Mine\n");
    assert_eq!(
        push_document(
            &FolderSource::new(&source_root),
            &conn,
            vault.id,
            &untracked
        )
        .expect("answered"),
        PushOutcome::NotTracked
    );
    assert_eq!(fs::read_to_string(&untracked).expect("read"), "# Mine\n");

    drop(conn);
    let _ = fs::remove_dir_all(&dir);
}
