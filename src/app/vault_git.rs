//! A vault's standing with GitHub, and the four things the panel can ask for.
//!
//! Every one of them runs on its own thread. `git status` on a large vault is disk-bound and a push is network-bound; either on the event loop is the app stopping dead, which is the mistake the graph already taught this codebase once.

use super::*;

/// What the panel draws. Sent whole on every change rather than patched, so the page never has to work out which half of it is stale.
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct VaultGitState {
    pub(crate) id: i64,
    /// The repository name a new repo would get, from the vault's own name.
    pub(crate) suggested: String,
    pub(crate) tooling: GitTooling,
    pub(crate) repo: VaultRepo,
    /// Something is running. The panel disables its buttons rather than letting a second push start behind the first.
    pub(crate) busy: bool,
    /// What just happened, in one line, or what went wrong.
    pub(crate) message: Option<String>,
    pub(crate) error: bool,
}

impl VaultGitState {
    fn idle(id: i64, suggested: String, tooling: GitTooling, repo: VaultRepo) -> Self {
        Self {
            id,
            suggested,
            tooling,
            repo,
            busy: false,
            message: None,
            error: false,
        }
    }
}

/// The vault's id and folder, or nothing when the row has gone.
fn vault_root(state: &VaultState, id: i64) -> Option<(String, PathBuf)> {
    let conn = state.conn.as_ref()?;
    let vault = find_vault(conn, id).ok().flatten()?;
    Some((vault.name, PathBuf::from(vault.root_path)))
}

/// Tell the panel a job has started, before starting it. Without this the first feedback is the result, and a push over a slow line looks like a dead button.
fn mark_busy(webview: Option<&WebView>, id: i64) {
    run_page_script(
        webview,
        &format!("window.leafVaultGitBusy({id});"),
        "Failed to mark the vault git panel busy",
    );
}

/// Run `job` off the event loop and post whatever it decides back as the panel's next whole state. The job gets the vault's folder and its name.
fn off_thread<F>(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    id: i64,
    job: F,
) where
    F: FnOnce(&Path, &str) -> (Option<String>, bool) + Send + 'static,
{
    let Some((name, root)) = vault_root(state, id) else {
        return;
    };
    mark_busy(webview, id);
    off_loop(proxy, move || {
        let (message, error) = job(&root, &name);
        // Whatever happened, the panel is redrawn from a fresh reading of the folder — the outcome message says what was attempted, the state says where that left things.
        let mut next = VaultGitState::idle(
            id,
            repo_name_for_vault(&name),
            git_tooling(),
            inspect_vault_repo(&root, NestedScan::Walk),
        );
        next.message = message;
        next.error = error;
        UserEvent::VaultGitReady {
            json: serde_json::to_string(&next).unwrap_or_else(|_| "null".to_string()),
        }
    });
}

/// Clone `url` into `parent` and, when it lands, register the clone as a vault. Off the loop like every other git call: a clone is a download, and the loop is the window.
///
/// There is no vault yet, so this cannot report through the panel the way the other four do. A toast says what happened, and the vault appearing in the switcher is what says it worked.
pub(crate) fn clone_vault(url: String, parent: PathBuf, proxy: &EventLoopProxy<UserEvent>) {
    off_loop(proxy, move || match clone_into_vault(&url, &parent) {
        Ok(folder) => UserEvent::VaultCloneDone {
            folder,
            error: None,
        },
        Err(error) => UserEvent::VaultCloneDone {
            folder: parent,
            error: Some(error.to_string()),
        },
    });
}

/// A finished clone: the new folder becomes a vault, or the failure is said out loud. Nothing half-made is left behind — git removes a folder it created when the clone fails, so there is no half-vault to register.
pub(crate) fn deliver_vault_clone(
    folder: PathBuf,
    error: Option<String>,
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    if let Some(error) = error {
        report_file_action_failure(webview, &error);
        return;
    }
    // The one place a vault is anything but a folder somebody picked, and the only chance to record it: what git left behind is a folder like any other, so nothing read later could tell this apart.
    create_vault(&folder, VaultKind::Git, state, proxy, webview);
}

/// Read only the folder's own state, for the button in the vault's header.
///
/// Deliberately not [`request_vault_git`]: that one also asks what is installed, and `gh auth status` goes to the network to validate its token. Fine once, when someone opens the panel; not fine every time a file is saved.
///
/// Nothing here fetches either, so `behind` is as stale as the last sync. What the button is for is work of yours that has not left the machine, and git knows that without asking anyone.
pub(crate) fn refresh_vault_status(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    id: i64,
) {
    let generation = state.change_generation;
    let Some((root, generation)) = status_read_to_start(state, id, generation) else {
        return;
    };
    read_vault_status_off_loop(proxy, id, generation, root);
}

/// The folder a status read would walk, or nothing where there is no such vault or one is already running for it. State alone and no worker, which is what lets a test ask it.
///
/// One read per vault at a time — each is a thread and five git processes, so a burst of saves must not start one each.
pub(crate) fn status_read_to_start(
    state: &mut VaultState,
    id: i64,
    generation: u64,
) -> Option<(PathBuf, u64)> {
    let (_name, root) = vault_root(state, id)?;
    state.may_read_status(id, generation).then_some((root, generation))
}

/// The folder the one repeat is owed against, once a status answer has reached the page — or nothing where nobody asked while the read was running.
pub(crate) fn status_read_after_delivery(
    state: &mut VaultState,
    id: i64,
) -> Option<(PathBuf, u64)> {
    let generation = state.status_read_settled(id)?;
    status_read_to_start(state, id, generation)
}

/// The per-save reading, which walks nothing: what the folder holds is the panel's question, and a three-deep directory walk on every save is what this read is cheap in order to avoid.
pub(crate) fn read_vault_status(root: &Path) -> VaultRepo {
    inspect_vault_repo(root, NestedScan::Skip)
}

/// Walk the folder on a worker and post what git says back to the loop.
pub(crate) fn read_vault_status_off_loop(
    proxy: &EventLoopProxy<UserEvent>,
    id: i64,
    generation: u64,
    root: PathBuf,
) {
    off_loop(proxy, move || {
        let repo = read_vault_status(&root);
        UserEvent::VaultStatusReady {
            id,
            generation,
            json: serde_json::to_string(&repo).unwrap_or_else(|_| "null".to_string()),
        }
    });
}

/// Hand the header's button its vault's state, then let the next read for that vault start.
///
/// Anything that asked while this one was running gets exactly one repeat, the way a corpus read serves whatever waited on it.
pub(crate) fn deliver_vault_status(
    webview: Option<&WebView>,
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    id: i64,
    generation: u64,
    json: &str,
) {
    run_page_script(
        webview,
        &format!("window.leafSetVaultStatus({id}, {json}, {generation});"),
        "Failed to update the vault status",
    );
    if let Some((root, generation)) = status_read_after_delivery(state, id) {
        read_vault_status_off_loop(proxy, id, generation, root);
    }
}

/// Read the vault's situation without changing anything. Opening the panel.
pub(crate) fn request_vault_git(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    id: i64,
) {
    off_thread(state, proxy, webview, id, |_root, _name| (None, false));
}

/// Make the folder a repository and put it on GitHub. `gh` when it is there; otherwise the local half is still done, and the panel offers the browser for the rest — a folder with one commit in it and no remote is a useful place to be, not a failure.
pub(crate) fn create_vault_repo(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    id: i64,
) {
    off_thread(state, proxy, webview, id, |root, name| {
        let existing = inspect_vault_repo(root, NestedScan::Walk);
        if !existing.at_root {
            if let Err(error) = init_vault_repo(root, &existing.nested) {
                return (Some(failure_message(&error)), true);
            }
        }
        if !git_tooling().gh {
            return (Some(String::from("local-only")), false);
        }
        match create_repo_on_github(root, &repo_name_for_vault(name)) {
            Ok(()) => (Some(String::from("created")), false),
            Err(error) => (Some(failure_message(&error)), true),
        }
    });
}

/// Point the vault at a repository the user made in the browser. Initializes first when the folder is not a repository yet, so one paste is the whole job.
pub(crate) fn link_vault_repo(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    id: i64,
    url: String,
) {
    off_thread(state, proxy, webview, id, move |root, _name| {
        let existing = inspect_vault_repo(root, NestedScan::Walk);
        if !existing.at_root {
            if let Err(error) = init_vault_repo(root, &existing.nested) {
                return (Some(failure_message(&error)), true);
            }
        }
        match link_vault_remote(root, &url) {
            Ok(()) => (Some(String::from("linked")), false),
            Err(error) => (Some(failure_message(&error)), true),
        }
    });
}

/// Put the repositories nothing is holding back into the vault's own `.gitignore`, through the same helper and with the same reason `init_vault_repo` writes when it makes a repository. Rides the panel's helper like the rest, so the panel is read back afterwards and the warning going is the proof it landed.
///
/// A path the file already names is skipped by the helper, so a second press writes nothing rather than a second copy of the block.
pub(crate) fn ignore_vault_repos(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    id: i64,
    paths: Vec<String>,
) {
    off_thread(state, proxy, webview, id, move |root, _name| {
        if paths.is_empty() {
            return (None, false);
        }
        match write_gitignore(root, &paths) {
            Ok(()) => (Some(String::from("ignored")), false),
            Err(error) => (Some(failure_message(&error)), true),
        }
    });
}

/// Tell git who is committing. Rides the same helper as the other four -- the panel goes busy, the write happens off the loop, and the whole state is read back -- so the red note going is the proof it landed, with nothing else to wire up.
///
/// The write is not the vault's: the id only says which panel to redraw. `set_git_identity` writes for the machine, because that is where the note is read from.
pub(crate) fn set_vault_git_identity(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    id: i64,
    name: String,
    email: String,
) {
    off_thread(
        state,
        proxy,
        webview,
        id,
        move |_root, _vault| match set_git_identity(&name, &email) {
            Ok(()) => (Some(String::from("identity-set")), false),
            Err(error) => (Some(failure_message(&error)), true),
        },
    );
}

/// Commit, pull, push.
pub(crate) fn sync_vault(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    id: i64,
) {
    off_thread(
        state,
        proxy,
        webview,
        id,
        |root, _name| match sync_vault_repo(root) {
            Ok(report) => (
                Some(format!(
                    "synced:{}:{}",
                    report.committed,
                    u8::from(report.pulled)
                )),
                false,
            ),
            Err(error) => (Some(failure_message(&error)), true),
        },
    );
}

/// Hand a finished job's state to the page.
pub(crate) fn deliver_vault_git(webview: Option<&WebView>, json: &str) {
    run_page_script(
        webview,
        &format!("window.leafSetVaultGit({json});"),
        "Failed to update the vault git panel",
    );
}
