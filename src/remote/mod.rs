//! Vaults whose files are not on this machine to begin with.
//!
//! Everything that reads a vault reads a path out of it — the library pane, search, the link graph, the pager and the watcher — so a remote vault is not a second kind of reader. It is a folder the app owns and copies into, and those five carry on reading the disk exactly as they did. What lives here is the half above that copy: what a source is, what it can be asked, and how its answers become files.
//!
//! This module holds the vocabulary and the one pipeline that orders the stages; `mirror` owns the folder the files land in and `folder` is a source that is just another folder on this disk — the one that proves the copy with nothing that can rate-limit.

mod folder;
mod mirror;

pub use folder::FolderSource;
pub use mirror::{remove_vault_mirror, vault_mirror_dir, MIRROR_DIR_NAME, POINTER_SUFFIX};

use std::path::Path;

use serde::Serialize;

use crate::is_listed_document_path;

/// How deep under the picked folder the mirror will walk. A source is asked what is in one folder at a time, and a source that answers with a loop — or with a tree deeper than anybody meant to point at — must not be able to walk this thread forever. What it stops is counted rather than swallowed.
const MAX_MIRROR_DEPTH: usize = 24;

/// What went wrong, in terms a panel can say out loud.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteError {
    /// The source cannot do this at all — a read-only one asked to send a document back, or one with no change feed asked what moved. Named so the interface can hide what a source has not got rather than offering a control that always fails.
    Unsupported(&'static str),
    /// The source moved on before the push landed. The local file is kept; nothing is overwritten in either direction until somebody chooses.
    Moved,
    /// Whatever the source or the machine said, in its own words.
    Failed(String),
}

impl std::fmt::Display for RemoteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(what) => write!(formatter, "this source cannot {what}"),
            Self::Moved => write!(formatter, "someone changed it before this could be sent"),
            Self::Failed(why) => write!(formatter, "{why}"),
        }
    }
}

pub type RemoteResult<T> = Result<T, RemoteError>;

/// What one entry in a source's folder is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteEntryKind {
    /// Bytes to copy down.
    File,
    /// Something to ask about in turn.
    Folder,
    /// A document with no bytes at all — a page on a service rather than a file. A pointer is written instead, and fetching the live thing is [`api-documents`](https://leaftext.com)'s, not this module's.
    Document,
}

/// One thing a source has. `id` is the identity and the name never is: a rename upstream moves this entry rather than making a second one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEntry {
    pub id: String,
    pub name: String,
    pub kind: RemoteEntryKind,
    /// Whatever stamp the source gives a version — an etag, a revision number, a modified time. Compared for equality and never parsed, because no two sources agree on what one is.
    pub version: Option<String>,
    pub size: Option<u64>,
}

/// What moved since a token, and the token to ask with next time.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RemoteChanges {
    pub changed: Vec<RemoteEntry>,
    /// Ids the source no longer has.
    pub removed: Vec<String>,
    pub next_token: Option<String>,
}

/// A place documents come from. Four questions, and a source that cannot answer one says so rather than inventing a shape of its own.
///
/// Nothing here knows about vaults, mirrors or the database — that is [`fill_mirror`]'s, so a new source is a reader, a writer and a sign-in and nothing else.
pub trait RemoteSource {
    /// What this source is called. It goes in the pointer file, so it is stable rather than pretty.
    fn source_name(&self) -> &str;

    /// One folder's contents. The empty string is the folder the vault was pointed at.
    fn list(&self, folder: &str) -> RemoteResult<Vec<RemoteEntry>>;

    /// Copy one entry's bytes to `into`, which the caller has already made a place for.
    fn fetch(&self, id: &str, into: &Path) -> RemoteResult<()>;

    /// Send a local file back, and answer with the version the source now holds. `base_version` is what was read; a source that has moved past it answers [`RemoteError::Moved`] rather than overwriting somebody.
    fn push(&self, _path: &Path, _id: &str, _base_version: Option<&str>) -> RemoteResult<String> {
        Err(RemoteError::Unsupported("send a document back"))
    }

    /// What moved since `token`. `None` is the first ask.
    fn changes(&self, _token: Option<&str>) -> RemoteResult<RemoteChanges> {
        Err(RemoteError::Unsupported("say what has changed"))
    }
}

/// A document with no bytes to copy. The mirror keeps this instead, naming where to go and get the live thing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePointer {
    pub source: String,
    pub id: String,
    pub account: Option<String>,
}

/// What one pass over a source left in the mirror. Every number it reports is one a reader could otherwise only find by counting the folder themselves.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MirrorReport {
    pub copied: usize,
    /// Documents with no bytes, written as pointers.
    pub pointers: usize,
    /// Entries the app cannot open, left where they were. A mirror is not a backup: pulling a folder of video onto somebody's disk to then not open it is the crawl mistake in another costume.
    pub skipped: usize,
    /// Folders left unread because the source nested past the depth cap.
    pub too_deep: usize,
    /// Names the source gave that could not be written down as one path component. Counted rather than ignored, because a source producing them is a source doing something worth knowing about.
    pub refused_names: usize,
}

/// Copy `folder` and everything under it out of `source` and into `into`.
///
/// Only what the app can open comes down; the rest is skipped, not copied. What a remote vault can show is `format.rs`'s table and never a second list, so a format added there is a format that arrives here by existing.
pub fn fill_mirror(
    source: &dyn RemoteSource,
    folder: &str,
    into: &Path,
    account: Option<&str>,
) -> RemoteResult<MirrorReport> {
    let mut report = MirrorReport::default();
    copy_folder(source, folder, into, account, 0, &mut report)?;
    Ok(report)
}

fn copy_folder(
    source: &dyn RemoteSource,
    folder: &str,
    into: &Path,
    account: Option<&str>,
    depth: usize,
    report: &mut MirrorReport,
) -> RemoteResult<()> {
    if depth >= MAX_MIRROR_DEPTH {
        report.too_deep += 1;
        return Ok(());
    }
    std::fs::create_dir_all(into).map_err(failed)?;

    for entry in source.list(folder)? {
        // A name is the source's text, not ours, and it is about to become a path. One that could climb out of the mirror is refused outright rather than cleaned up into something that looks like it worked.
        let Some(name) = safe_name(&entry.name) else {
            report.refused_names += 1;
            continue;
        };
        match entry.kind {
            RemoteEntryKind::Folder => {
                copy_folder(
                    source,
                    &entry.id,
                    &into.join(name),
                    account,
                    depth + 1,
                    report,
                )?;
            }
            RemoteEntryKind::Document => {
                let path = into.join(format!("{name}{POINTER_SUFFIX}"));
                mirror::write_pointer(
                    &path,
                    &RemotePointer {
                        source: source.source_name().to_string(),
                        id: entry.id.clone(),
                        account: account.map(str::to_string),
                    },
                )
                .map_err(failed)?;
                report.pointers += 1;
            }
            RemoteEntryKind::File => {
                let path = into.join(name);
                if !is_listed_document_path(&path) {
                    report.skipped += 1;
                    continue;
                }
                source.fetch(&entry.id, &path)?;
                report.copied += 1;
            }
        }
    }
    Ok(())
}

/// What one refresh pass did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RefreshReport {
    /// Documents fetched again because the source says they moved.
    pub updated: usize,
    /// Documents that changed their name or their folder upstream. One entry moved each, never a second one written beside the first.
    pub moved: usize,
    /// Documents the source no longer has, taken out of the mirror with them.
    pub removed: usize,
    pub skipped: usize,
    pub refused_names: usize,
    /// The token to ask with next time, saved so the pass after this one asks about what has happened since rather than about everything.
    pub next_token: Option<String>,
}

/// Bring a mirror up to date with what the source says has moved since `token`.
///
/// **Identity is the source's id.** A document renamed upstream keeps its id, so the row it already has is moved — the file on this machine is renamed and the record follows it. Matching on the name instead would leave the old file lying in the mirror beside the new one, and the link graph would draw a note joined to its own ghost.
#[cfg(feature = "desktop")]
pub fn refresh_mirror(
    source: &dyn RemoteSource,
    conn: &rusqlite::Connection,
    vault_id: i64,
    mirror_root: &Path,
    token: Option<&str>,
) -> RemoteResult<RefreshReport> {
    use crate::store::{forget_remote_file, record_remote_file, remote_file};

    let changes = source.changes(token)?;
    let mut report = RefreshReport {
        next_token: changes.next_token.clone(),
        ..RefreshReport::default()
    };

    for id in &changes.removed {
        if let Ok(Some(held)) = remote_file(conn, vault_id, id) {
            let _ = std::fs::remove_file(&held.local_path);
            report.removed += 1;
        }
        let _ = forget_remote_file(conn, vault_id, id);
    }

    for entry in &changes.changed {
        if matches!(entry.kind, RemoteEntryKind::Folder) {
            continue;
        }
        let Some(name) = safe_name(&entry.name) else {
            report.refused_names += 1;
            continue;
        };
        // The source says where a document sits now; the mirror keeps that shape, so the graph and the pager go on reading the folders somebody actually wrote.
        let landing = match entry.kind {
            RemoteEntryKind::Document => mirror_root.join(format!("{name}{POINTER_SUFFIX}")),
            _ => mirror_root.join(&name),
        };
        if matches!(entry.kind, RemoteEntryKind::File) && !is_listed_document_path(&landing) {
            report.skipped += 1;
            continue;
        }

        let held = remote_file(conn, vault_id, &entry.id).ok().flatten();
        // Renamed or moved: the same document, so the file it already is moves rather than a second one appearing beside it.
        if let Some(held) = held.as_ref() {
            let was = Path::new(&held.local_path);
            if was != landing && was.exists() {
                if let Some(parent) = landing.parent() {
                    std::fs::create_dir_all(parent).map_err(failed)?;
                }
                std::fs::rename(was, &landing).map_err(failed)?;
                report.moved += 1;
            }
        }
        // The stamp is compared and never parsed: no two sources agree on what a version is. Equal means the bytes are the ones already here, so nothing is fetched.
        let unchanged = held
            .as_ref()
            .is_some_and(|held| held.version.is_some() && held.version == entry.version);
        if !unchanged {
            match entry.kind {
                RemoteEntryKind::Document => {
                    mirror::write_pointer(
                        &landing,
                        &RemotePointer {
                            source: source.source_name().to_string(),
                            id: entry.id.clone(),
                            account: None,
                        },
                    )
                    .map_err(failed)?;
                }
                _ => source.fetch(&entry.id, &landing)?,
            }
            report.updated += 1;
        }
        record_remote_file(
            conn,
            vault_id,
            &entry.id,
            &landing.to_string_lossy(),
            entry.version.as_deref(),
        )
        .map_err(RemoteError::Failed)?;
    }

    Ok(report)
}

/// What happened to a document going the other way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushOutcome {
    /// The source took it and now holds this version.
    Sent(String),
    /// Somebody moved it first. The local file is untouched, and so is the version this vault last read — so the next refresh sees the difference and can offer theirs.
    Refused,
    /// Not a document any mirror is tracking, which is every save in a folder vault. Nothing was sent and nothing needed to be.
    NotTracked,
}

/// Send a saved document back to the source it came from.
///
/// **Called after the local write, never instead of it.** The bytes are on this machine before this runs, so a push that fails, times out or is refused cannot lose what somebody typed — the worst it can do is leave the two copies disagreeing, which is a thing the panel can say and a person can settle.
///
/// The version carried is the one this vault last read. A source that has moved past it answers [`RemoteError::Moved`] rather than overwriting whoever moved it, and nothing here is silently reverted in either direction.
#[cfg(feature = "desktop")]
pub fn push_document(
    source: &dyn RemoteSource,
    conn: &rusqlite::Connection,
    vault_id: i64,
    path: &Path,
) -> RemoteResult<PushOutcome> {
    use crate::store::{list_remote_files, record_remote_file};

    let wanted = path.to_string_lossy();
    let held = list_remote_files(conn, vault_id)
        .map_err(RemoteError::Failed)?
        .into_iter()
        .find(|file| file.local_path == wanted);
    let Some(held) = held else {
        return Ok(PushOutcome::NotTracked);
    };

    match source.push(path, &held.remote_id, held.version.as_deref()) {
        Ok(version) => {
            record_remote_file(
                conn,
                vault_id,
                &held.remote_id,
                &held.local_path,
                Some(&version),
            )
            .map_err(RemoteError::Failed)?;
            Ok(PushOutcome::Sent(version))
        }
        // The row keeps the version it had. That is what lets the next refresh see the source has moved and offer what is there.
        Err(RemoteError::Moved) => Ok(PushOutcome::Refused),
        Err(other) => Err(other),
    }
}

/// The one path component a source's name may become, or `None` when it may not become one at all.
///
/// A remote is not trusted to name its own files: `..`, a separator of either kind, a drive letter or a device name would each write outside the folder the app owns, and a mirror that can be steered out of its own directory is a source with a write anywhere on the disk.
fn safe_name(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    if name.contains(['/', '\\', ':', '\0']) {
        return None;
    }
    // A trailing dot or space is dropped by Windows when the file is created, so two different names would land on one file.
    if name.ends_with('.') || name.ends_with(' ') {
        return None;
    }
    Some(name.to_string())
}

fn failed<E: std::fmt::Display>(error: E) -> RemoteError {
    RemoteError::Failed(error.to_string())
}
