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
            inspect_vault_repo(&root),
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
    create_vault(&folder, state, proxy, webview);
}

/// Read only the folder's own state, for the button in the vault's header.
///
/// Deliberately not [`request_vault_git`]: that one also asks what is installed, and `gh auth status` goes to the network to validate its token. Fine once, when someone opens the panel; not fine every time a file is saved.
///
/// Nothing here fetches either, so `behind` is as stale as the last sync. What the button is for is work of yours that has not left the machine, and git knows that without asking anyone.
pub(crate) fn refresh_vault_status(state: &VaultState, proxy: &EventLoopProxy<UserEvent>, id: i64) {
    let Some((_name, root)) = vault_root(state, id) else {
        return;
    };
    off_loop(proxy, move || {
        let repo = inspect_vault_repo(&root);
        UserEvent::VaultStatusReady {
            id,
            json: serde_json::to_string(&repo).unwrap_or_else(|_| "null".to_string()),
        }
    });
}

/// Hand the header's button its vault's state.
pub(crate) fn deliver_vault_status(webview: Option<&WebView>, id: i64, json: &str) {
    run_page_script(
        webview,
        &format!("window.leafSetVaultStatus({id}, {json});"),
        "Failed to update the vault status",
    );
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
        let existing = inspect_vault_repo(root);
        if !existing.at_root {
            if let Err(error) = init_vault_repo(root, &existing.nested) {
                return (Some(error.to_string()), true);
            }
        }
        if !git_tooling().gh {
            return (Some(String::from("local-only")), false);
        }
        match create_repo_on_github(root, &repo_name_for_vault(name)) {
            Ok(()) => (Some(String::from("created")), false),
            Err(error) => (Some(error.to_string()), true),
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
        let existing = inspect_vault_repo(root);
        if !existing.at_root {
            if let Err(error) = init_vault_repo(root, &existing.nested) {
                return (Some(error.to_string()), true);
            }
        }
        match link_vault_remote(root, &url) {
            Ok(()) => (Some(String::from("linked")), false),
            Err(error) => (Some(error.to_string()), true),
        }
    });
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
            Err(error) => (Some(error.to_string()), true),
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
