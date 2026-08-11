//! Keeping a remote vault's mirror up to date, and saying so.
//!
//! Every pass runs off the event loop, like every other job that touches a disk or a network. **Opening a document never waits on one**: the files are already on this machine, so a refresh is something happening beside the reader rather than in front of them, and the only thing it owes them is a line saying where it got to.
//!
//! Nothing here is a crawl. One picked folder and what is under it, on a timer, and a source that is refusing is left alone rather than asked harder — a rate limit answers in lockouts rather than in slow.

// The shared half of a remote vault: the sources these passes run against are storage-services.md's, so a shipping build has no caller for most of this yet. Allowed at the module rather than left to warn, because a warning nobody can act on is one everybody learns to skip.
#![allow(dead_code)]

use super::*;

use std::collections::HashMap;

use leaftext::remote::{push_document, PushOutcome, RemoteError, RemoteSource};

/// How long between passes. Long enough that a vault somebody is not touching costs almost nothing, short enough that a document edited on another machine is here before it is missed.
const REFRESH_INTERVAL: Duration = Duration::from_secs(300);

/// How many passes in a row may fail before the timer stops asking. A source that is refusing goes on refusing, and asking every five minutes forever is how an account gets shut off rather than rate-limited. A Refresh in the panel starts it again, because the person pressing it knows something the app does not.
const REFRESH_FAILURES_BEFORE_RESTING: u32 = 3;

/// What the vault's panel draws about the copy on this machine. Sent whole on every change rather than patched, so the page never has to work out which half of it is stale — the same rule the GitHub panel beside it follows.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultRemoteState {
    pub(crate) id: i64,
    /// A pass is running. The panel dims its buttons rather than letting a second start behind the first.
    pub(crate) busy: bool,
    /// Seconds since the epoch when the last pass finished, or nothing when none has.
    pub(crate) refreshed_at: Option<i64>,
    /// The source could not be reached. **A line, not an error**: the files were copied down and they read, so being offline changes what is fresh rather than what is possible.
    pub(crate) offline: bool,
    /// The timer has stopped asking after too many refusals in a row. Pressing Refresh starts it again.
    pub(crate) resting: bool,
    /// What the last pass did, or what went wrong.
    pub(crate) message: Option<String>,
    pub(crate) error: bool,
}

/// What the loop remembers between passes: the token to ask with, how many refusals in a row, and which mirrors are being written right now.
#[derive(Default)]
pub(crate) struct RefreshBook {
    seen: HashMap<i64, VaultRemoteState>,
    tokens: HashMap<i64, String>,
    failures: HashMap<i64, u32>,
    /// Mirrors a pass is writing into. Every file it writes reaches the watcher, and the watcher reaches the loop, where an active vault spends a thread on `git status` before anything else is decided — 2,000 files measured as 2,020 events. The app's own writes are not news, so they are dropped while the pass that made them is running.
    writing: Vec<PathBuf>,
}

impl RefreshBook {
    /// Whether a file change is this app writing its own mirror rather than somebody editing.
    pub(crate) fn is_our_own_write(&self, changed: &Path) -> bool {
        self.writing.iter().any(|root| changed.starts_with(root))
    }

    pub(crate) fn begin(&mut self, id: i64, mirror: PathBuf) {
        self.writing.push(mirror);
        let mut state = self.seen.remove(&id).unwrap_or_default();
        state.id = id;
        state.busy = true;
        state.message = None;
        state.error = false;
        state.resting = false;
        self.seen.insert(id, state);
    }

    pub(crate) fn end(&mut self, id: i64, mirror: &Path, state: VaultRemoteState) {
        self.writing.retain(|root| root != mirror);
        self.seen.insert(id, state);
    }

    pub(crate) fn token(&self, id: i64) -> Option<&str> {
        self.tokens.get(&id).map(String::as_str)
    }

    pub(crate) fn remember_token(&mut self, id: i64, token: Option<String>) {
        match token {
            Some(token) => {
                self.tokens.insert(id, token);
            }
            None => {
                self.tokens.remove(&id);
            }
        }
    }

    /// Whether the timer should leave this vault alone. It rests after enough refusals in a row, and a Refresh from the panel clears the count because the person pressing it knows something the app does not.
    pub(crate) fn is_resting(&self, id: i64) -> bool {
        self.failures
            .get(&id)
            .is_some_and(|count| *count >= REFRESH_FAILURES_BEFORE_RESTING)
    }

    pub(crate) fn record_outcome(&mut self, id: i64, failed: bool) {
        if failed {
            *self.failures.entry(id).or_insert(0) += 1;
        } else {
            self.failures.remove(&id);
        }
    }

    pub(crate) fn wake(&mut self, id: i64) {
        self.failures.remove(&id);
    }

    pub(crate) fn state(&self, id: i64) -> Option<&VaultRemoteState> {
        self.seen.get(&id)
    }

    pub(crate) fn is_busy(&self, id: i64) -> bool {
        self.seen.get(&id).is_some_and(|state| state.busy)
    }
}

/// Start the clock. One thread, sleeping between ticks and posting each one to the loop, which is the only place that knows which vaults are worth asking, which are busy and which are resting.
///
/// The thread ends with the window: a proxy that will not take an event is a loop that has gone.
pub(crate) fn start_refresh_timer(proxy: &EventLoopProxy<UserEvent>) {
    let proxy = proxy.clone();
    thread::spawn(move || loop {
        thread::sleep(REFRESH_INTERVAL);
        if proxy.send_event(UserEvent::RemoteRefreshDue).is_err() {
            return;
        }
    });
}

/// Whether a finished pass is still about the folder the vault has.
///
/// A vault removed while its pass ran has had its mirror deleted underneath it; one pointed somewhere else has a pass about a folder nobody is reading. Either way the answer is thrown away rather than delivered, which is what `deliver_folder` and `deliver_corpus` already do with a read that outlived its vault.
pub(crate) fn refresh_still_lands(current_root: Option<&Path>, ran_under: &Path) -> bool {
    current_root == Some(ran_under)
}

/// Hand the panel a vault's standing.
pub(crate) fn deliver_vault_remote(webview: Option<&WebView>, state: &VaultRemoteState) {
    let json = serde_json::to_string(state).unwrap_or_else(|_| "null".to_string());
    run_page_script(
        webview,
        &format!("window.leafSetVaultRemote({json});"),
        "Failed to update the vault's copy panel",
    );
}

/// Every vault whose files come from somewhere else, in the order they were added.
pub(crate) fn remote_vaults(state: &VaultState) -> Vec<Vault> {
    state
        .vaults()
        .into_iter()
        .filter(|vault| vault.kind.signs_in())
        .collect()
}

/// The clock ticked. Ask every remote vault that is not already busy and not resting.
///
/// Nothing here waits: each pass goes to its own thread and answers with an event, so a source that has gone quiet holds up no reading, no typing and no painting.
pub(crate) fn refresh_due_vaults(
    state: &VaultState,
    book: &mut RefreshBook,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    for vault in remote_vaults(state) {
        if book.is_busy(vault.id) || book.is_resting(vault.id) {
            continue;
        }
        start_refresh(&vault, state, book, proxy, webview);
    }
}

/// Ask one vault's source what has moved, off the loop.
///
/// There is no source to ask yet — every kind that ships keeps its files on this machine — so what this does today is raise the busy flag, find nothing to ask, and put it down again. The shape is the point: [`storage-services.md`](https://leaftext.com) hands it a source and nothing here changes.
pub(crate) fn start_refresh(
    vault: &Vault,
    _state: &VaultState,
    book: &mut RefreshBook,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    let id = vault.id;
    let mirror = PathBuf::from(&vault.root_path);
    book.begin(id, mirror.clone());
    if let Some(state) = book.state(id) {
        deliver_vault_remote(webview, state);
    }

    let ran_under = mirror.clone();
    off_loop(proxy, move || {
        // Nothing to ask, so nothing moved. A source arrives with the services that have one.
        let state = VaultRemoteState {
            id,
            busy: false,
            refreshed_at: Some(now_seconds()),
            offline: false,
            resting: false,
            message: None,
            error: false,
        };
        UserEvent::RemoteRefreshDone {
            id,
            ran_under,
            state: Box::new(state),
        }
    });
}

/// A pass finished. Thrown away when the vault it was about has gone or been pointed somewhere else, the way a folder read and a corpus read already are.
pub(crate) fn deliver_refresh(
    id: i64,
    ran_under: PathBuf,
    state: VaultRemoteState,
    vault_state: &VaultState,
    book: &mut RefreshBook,
    webview: Option<&WebView>,
) {
    let current = vault_root_path(vault_state, id);
    book.end(id, &ran_under, state.clone());
    if !refresh_still_lands(current.as_deref(), &ran_under) {
        return;
    }
    book.record_outcome(id, state.error);
    deliver_vault_remote(webview, &state);
}

/// Send a document that has just been saved back to wherever it came from.
///
/// **Called after the write, never instead of it.** Nothing about Save changes: the bytes reach this machine first, exactly as they always have, and only then does anything try to send them on. A push that fails cannot take back what was typed — the file is already there — and what it costs instead is a line in the vault's panel saying the two copies disagree.
///
/// A document in a folder vault is not tracked by any mirror, so this finds nothing and says nothing, which is every save the app does today.
pub(crate) fn push_saved_document(
    state: &VaultState,
    book: &mut RefreshBook,
    webview: Option<&WebView>,
    path: &Path,
) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    let Some(vault) = vault_containing(conn, path).filter(|vault| vault.kind.signs_in()) else {
        return;
    };
    let Some(source) = source_for(&vault) else {
        return;
    };

    let outcome = push_document(source.as_ref(), conn, vault.id, path);
    let mut next = book.state(vault.id).cloned().unwrap_or(VaultRemoteState {
        id: vault.id,
        ..VaultRemoteState::default()
    });
    match outcome {
        Ok(PushOutcome::NotTracked) | Ok(PushOutcome::Sent(_)) => return,
        // Somebody moved first. What was typed is on this machine and stays there; the panel says so, and the next refresh is what offers theirs.
        Ok(PushOutcome::Refused) => {
            next.message = Some(
                "Somebody changed this before your copy could be sent. Your version is safe on this machine — refresh to see theirs.".to_string(),
            );
            next.error = true;
        }
        Err(error) => {
            next.message = Some(format!("Your version is safe on this machine. {error}"));
            next.error = true;
            next.offline = matches!(error, RemoteError::Failed(_));
        }
    }
    book.end(vault.id, Path::new(&vault.root_path), next.clone());
    deliver_vault_remote(webview, &next);
}

/// The source behind a vault. There is none for any kind that ships: a folder somebody picked and a clone are both already on this machine. [`storage-services.md`](https://leaftext.com) is what hands one back.
fn source_for(_vault: &Vault) -> Option<Box<dyn RemoteSource>> {
    None
}

/// Seconds since the epoch, for the "last refreshed" line. Zero where the clock is unreadable, which reads as "not since this app started" rather than as a time in the future.
fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs() as i64)
        .unwrap_or(0)
}
