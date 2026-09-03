//! Git, as much of it as a reader needs: is this vault a repo, what has changed in it, and push that somewhere.
//!
//! Shells out to the machine's own git, the way `platform.rs` shells out to `msiexec`. The user's git already knows who they are and how to log in to GitHub; a library would ship a second copy of both and be wrong about each. Nothing about the author, the host, or the credentials is written down here.
//!
//! Creating the repository is the one thing git cannot do — it is an API call and needs a token — so `gh` does it where it is installed and the browser where it is not. Either way the token stays where the user already keeps it.

use std::ffi::OsStr;
use std::fmt;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// How long any one git (or gh) call may run before it is killed. Git normally answers in well under a second; the only things that take longer are a large fetch and a credential helper popping a window the app cannot see. The second one would otherwise hang the sync forever -- the "spinning that never stops". Generous enough for a real fetch, short enough that a wedged prompt gives up.
const TOOL_TIMEOUT: Duration = Duration::from_secs(90);

/// How long a clone may run. Every other call here answers off the disk in a moment; a clone is a download of somebody's whole history, and 90 seconds would refuse any repository worth cloning.
const CLONE_TIMEOUT: Duration = Duration::from_secs(600);

/// How deep below a vault to look for repositories that would end up inside a new one. Three is enough for `leaftext/app`, and for a nested clone one level further down; past that the scan costs more than the warning is worth.
const NESTED_SCAN_DEPTH: usize = 3;

// Inner work cannot be staged here; a moved recorded commit still can.
const VAULT_STATUS_ARGS: &[&str] = &["status", "--porcelain", "--ignore-submodules=dirty"];

/// Something git (or gh) was asked to do and would not.
#[derive(Debug)]
pub struct GitError {
    /// What was being attempted, in the app's words.
    pub operation: String,
    /// What the tool said, trimmed to the part worth showing.
    pub detail: String,
}

impl fmt::Display for GitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.detail.is_empty() {
            write!(formatter, "{}", self.operation)
        } else {
            write!(formatter, "{}: {}", self.operation, self.detail)
        }
    }
}

impl GitError {
    fn new(operation: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            operation: operation.into(),
            detail: first_useful_line(&detail.into()),
        }
    }
}

/// What this machine can do, decided by what is installed rather than by what the app would prefer. Pushing needs git and a credential helper; creating a repository needs `gh`, or a browser.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTooling {
    pub git: bool,
    /// `gh` is installed *and* logged in. Installed-but-signed-out is no more use than absent, and telling them apart would only add a third message.
    pub gh: bool,
    /// Whether git has been told how to authenticate to GitHub. Absent, a push either prompts in a terminal the app does not have, or fails.
    pub credential_helper: bool,
    /// `user.name` and `user.email`. Without them git refuses to commit, and the message it gives is three paragraphs long.
    pub identity: bool,
}

/// A vault folder's standing with git.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRepo {
    /// A repository whose top level *is* this folder. A vault sitting inside someone else's repository is not one — see `outer`.
    pub at_root: bool,
    /// The repository this vault sits inside, when it is not its own. Worth naming: creating a repo here is legal and common, but it should not be a surprise afterwards.
    pub outer: Option<String>,
    /// Repositories below this folder, as paths relative to it. These are what a new repository at the root would swallow.
    pub nested: Vec<String>,
    /// `owner/name` where the remote is recognizable, else the raw URL.
    pub remote: Option<String>,
    /// The address exactly as git holds it, for showing before a change and for putting back if the change was a mistake. The label above is for reading; this is the thing you would paste.
    pub remote_url: Option<String>,
    pub branch: Option<String>,
    /// Files added, changed or deleted since the last commit.
    pub changed: usize,
    /// Whether the branch is tracking anything. Without it the counts below are meaningless and the first push has to set it.
    pub tracking: bool,
    pub ahead: usize,
    pub behind: usize,
}

/// What a sync did, so the page can say so rather than just going quiet.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub committed: usize,
    pub pulled: bool,
    pub pushed: bool,
}

// ---------------------------------------------------------------------------
// Running the tools
// ---------------------------------------------------------------------------

/// Spawn a tool and collect what it said, allowing `limit` for it. Windows gets `CREATE_NO_WINDOW`, or a console flashes over the reader on every status check.
fn output_within<I, S>(
    limit: Duration,
    program: &str,
    dir: Option<&Path>,
    args: I,
) -> std::io::Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new(program);
    command.args(args);
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    // A prompt would block forever behind a window that cannot show it. Tell git to fail instead, and the panel can say what is missing. `GCM_INTERACTIVE` and `GIT_ASKPASS` shut the same door on the credential helper, which is a *separate* program with its own window and does not read the first flag -- the one that left a sync spinning behind a dialog nobody could find.
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GCM_INTERACTIVE", "never");
    command.env("GIT_ASKPASS", "echo");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    run_with_timeout(command, limit)
}

/// The same, on the ordinary limit. Everything but a clone answers off the disk.
fn output<I, S>(program: &str, dir: Option<&Path>, args: I) -> std::io::Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    output_within(TOOL_TIMEOUT, program, dir, args)
}

/// Spawn a command and wait at most `limit` for it, killing it if it overruns.
///
/// The pipes are drained on their own threads so a chatty command (a fetch's progress) can never fill a pipe buffer and deadlock against a parent that is only watching the clock. A kill closes the pipes, so those threads then end.
fn run_with_timeout(mut command: Command, limit: Duration) -> std::io::Result<Output> {
    let mut child = command.spawn()?;
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    });
    let stderr_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    });
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            let stdout = stdout_reader.join().unwrap_or_default();
            let stderr = stderr_reader.join().unwrap_or_default();
            return Ok(Output {
                status,
                stdout,
                stderr,
            });
        }
        if start.elapsed() >= limit {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "the command took too long and was stopped",
            ));
        }
        thread::sleep(Duration::from_millis(40));
    }
}

/// Run git in `dir` and return its stdout. `Err` carries stderr.
///
/// Trailing whitespace only: a plain `trim()` ate the leading blank that is `status --porcelain`'s first status column, and a commit went out saying "Update EADME.md". Nothing else git prints has meaningful leading space.
fn git(dir: &Path, args: &[&str]) -> Result<String, GitError> {
    git_within(TOOL_TIMEOUT, dir, args)
}

/// The same, with its own limit — a clone is a download and outlives the limit a status question gets.
fn git_within(limit: Duration, dir: &Path, args: &[&str]) -> Result<String, GitError> {
    let operation = format!("git {}", args.first().copied().unwrap_or_default());
    match output_within(limit, "git", Some(dir), args) {
        Ok(result) if result.status.success() => Ok(String::from_utf8_lossy(&result.stdout)
            .trim_end()
            .to_string()),
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
            Err(GitError::new(
                operation,
                if stderr.is_empty() { stdout } else { stderr },
            ))
        }
        Err(error) => Err(GitError::new(operation, error.to_string())),
    }
}

/// Run git for a yes/no question, where failing *is* the answer.
fn git_ok(dir: &Path, args: &[&str]) -> bool {
    git(dir, args).is_ok()
}

/// Whether the index differs from HEAD, including the empty tree before a first commit.
fn staged_index_has_changes(dir: &Path) -> Result<bool, GitError> {
    match output("git", Some(dir), ["diff", "--cached", "--quiet"]) {
        Ok(result) if result.status.code() == Some(0) => Ok(false),
        Ok(result) if result.status.code() == Some(1) => Ok(true),
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
            Err(GitError::new(
                "git diff",
                if stderr.is_empty() { stdout } else { stderr },
            ))
        }
        Err(error) => Err(GitError::new("git diff", error.to_string())),
    }
}

// ---------------------------------------------------------------------------
// What is installed
// ---------------------------------------------------------------------------

pub fn git_tooling() -> GitTooling {
    let git_present = output("git", None, ["--version"]).is_ok_and(|out| out.status.success());
    if !git_present {
        return GitTooling::default();
    }
    let here = Path::new(".");
    GitTooling {
        git: true,
        // Installed is not enough: `gh repo create` on a signed-out gh fails with an auth error after the user has already committed to the button.
        gh: output("gh", None, ["auth", "status"]).is_ok_and(|out| out.status.success()),
        credential_helper: !configured(here, "credential.helper").is_empty(),
        identity: !configured(here, "user.name").is_empty()
            && !configured(here, "user.email").is_empty(),
    }
}

/// A git config value, or empty when it is unset. Reads whatever the machine says at this moment — nothing is cached and nothing is assumed.
fn configured(dir: &Path, key: &str) -> String {
    git(dir, &["config", "--get", key]).unwrap_or_default()
}

/// Tell git who is committing, for this whole machine.
///
/// Machine-wide because [`git_tooling`] reads it that way — `user.name` in the app's own folder, not in any vault. A write into one vault's repository would leave the panel's warning standing after a press that worked, and somebody with no identity at all wants it set once rather than once per vault.
pub fn set_git_identity(name: &str, email: &str) -> Result<(), GitError> {
    let name = identity_value("name", name)?;
    let email = identity_value("email", email)?;
    let here = Path::new(".");
    git(here, &["config", "--global", "user.name", name])?;
    git(here, &["config", "--global", "user.email", email])?;
    Ok(())
}

/// One of the two values, checked before git is ever run. Empty would clear the setting the button was pressed to fill, and a leading dash arrives at git as an option rather than as a name.
pub(crate) fn identity_value<'a>(what: &str, value: &'a str) -> Result<&'a str, GitError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(GitError::new("set identity", format!("no {what} given")));
    }
    if value.starts_with('-') {
        return Err(GitError::new(
            "set identity",
            format!("{what} cannot start with a dash"),
        ));
    }
    Ok(value)
}

// ---------------------------------------------------------------------------
// Reading a vault's situation
// ---------------------------------------------------------------------------

pub fn inspect_vault_repo(root: &Path) -> VaultRepo {
    let mut repo = VaultRepo::default();
    match git(root, &["rev-parse", "--show-toplevel"]) {
        Ok(top) if same_folder(&top, root) => repo.at_root = true,
        // A top level above us: this vault lives inside someone else's repo. That is `work/leaftext`, and it is not the vault's own repository.
        Ok(top) => repo.outer = Some(top),
        Err(_) => {}
    }

    if repo.at_root {
        let url = git(root, &["remote", "get-url", "origin"])
            .ok()
            .filter(|url| !url.is_empty());
        repo.remote = url.as_deref().map(remote_label);
        repo.remote_url = url;
        repo.branch = git(root, &["branch", "--show-current"])
            .ok()
            .filter(|branch| !branch.is_empty());
        repo.changed = git(root, VAULT_STATUS_ARGS)
            .map(|status| count_changes(&status))
            .unwrap_or(0);
        if let Ok(counts) = git(
            root,
            &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
        ) {
            let (behind, ahead) = parse_ahead_behind(&counts);
            repo.tracking = true;
            repo.behind = behind;
            repo.ahead = ahead;
        }
    } else {
        // Only worth scanning when a new repository here is on the table.
        repo.nested = nested_repos(root);
    }
    repo
}

/// Repositories below `root`, relative to it, deepest-first order not promised. Stops descending as soon as it finds one: a repo inside a repo inside a vault is that repo's business.
fn nested_repos(root: &Path) -> Vec<String> {
    let mut found = Vec::new();
    scan_nested(root, root, 0, &mut found);
    found.sort();
    found
}

fn scan_nested(root: &Path, dir: &Path, depth: usize, found: &mut Vec<String>) {
    if depth >= NESTED_SCAN_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        // The same rule the vault's walk stops at, so there is one list of the folders a machine fills rather than two that drift apart.
        if crate::vault_corpus::folder_holds_generated_files(&path) {
            continue;
        }
        if path.join(".git").exists() {
            if let Some(relative) = relative_label(root, &path) {
                found.push(relative);
            }
            continue;
        }
        scan_nested(root, &path, depth + 1, found);
    }
}

// ---------------------------------------------------------------------------
// Making a vault into a repository
// ---------------------------------------------------------------------------

/// Turn `root` into a repository with one commit in it. Does not talk to GitHub: that is the caller's next step, by whichever route the machine allows.
pub fn init_vault_repo(root: &Path, nested: &[String]) -> Result<(), GitError> {
    // `-b` rather than letting the machine's `init.defaultBranch` decide, so the branch the app then pushes is the branch it created.
    git(root, &["init", "-b", "main"])?;
    if !nested.is_empty() {
        write_gitignore(root, nested)?;
    }
    git(root, &["add", "-A"])?;
    git(root, &["commit", "-m", "Add the vault"])?;
    Ok(())
}

/// Append the nested repositories to `.gitignore`, keeping whatever is already there. Each one has its own remote and its own history; tracking it from out here would record a pointer nobody can follow.
fn write_gitignore(root: &Path, nested: &[String]) -> Result<(), GitError> {
    let path = root.join(".gitignore");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let addition = gitignore_addition(&existing, nested);
    if addition.is_empty() {
        return Ok(());
    }
    let mut contents = existing;
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    contents.push_str(&addition);
    std::fs::write(&path, contents)
        .map_err(|error| GitError::new("write .gitignore", error.to_string()))
}

/// Create the repository on GitHub through `gh` and push to it. Private, always: a vault is notes, and publishing them should be a deliberate act on the site rather than a side effect of a button in a reader.
pub fn create_repo_on_github(root: &Path, name: &str) -> Result<(), GitError> {
    let result = output(
        "gh",
        Some(root),
        [
            "repo",
            "create",
            name,
            "--private",
            "--source",
            ".",
            "--remote",
            "origin",
            "--push",
        ],
    )
    .map_err(|error| GitError::new("gh repo create", error.to_string()))?;
    if result.status.success() {
        return Ok(());
    }
    Err(GitError::new(
        "gh repo create",
        String::from_utf8_lossy(&result.stderr).to_string(),
    ))
}

/// Clone `url` into a new folder under `parent`, and return where it landed. The path from an address to a vault that does not exist yet.
///
/// The folder is git's to create, which is what makes a failure clean: git removes what it made, so a clone that dies half way leaves nothing behind to tidy up and nothing to register. A name already taken under `parent` is refused rather than cloned into — merging a clone into somebody's folder is not something to do on their behalf.
///
/// No credentials of ours, like every other call here: a private repository works when the machine's git can already log in, and says what is missing when it cannot (`GIT_TERMINAL_PROMPT=0`, above).
pub fn clone_into_vault(url: &str, parent: &Path) -> Result<PathBuf, GitError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(GitError::new("clone", "no address given"));
    }
    let Some(name) = repo_folder_name_for_url(url) else {
        return Err(GitError::new(
            "clone",
            "that address does not name a repository",
        ));
    };
    let target = parent.join(&name);
    if target.exists() {
        return Err(GitError::new(
            "clone",
            format!("{name} is already in that folder"),
        ));
    }
    git_within(CLONE_TIMEOUT, parent, &["clone", "--", url, &name])?;
    // git reports success and creates the folder itself, so anything else here is a success that left nothing to open.
    if !is_repo_root(&target) {
        return Err(GitError::new(
            "clone",
            "the clone left no repository behind",
        ));
    }
    Ok(target)
}

/// The folder name an address gives: `https://host/owner/repo.git`, `git@host:owner/repo` and a local path all end in the name to use.
///
/// `None` when there is no usable segment, and anything that is not a plain name is refused — a folder is joined onto the parent the user picked, and only a name can never reach outside it.
pub(crate) fn repo_folder_name_for_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches(['/', '\\']);
    let without_git = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    // Past the scheme first, or a bare host reads as a repository: `https://github.com` would clone into a folder called `github.com`, and the address names no repository at all.
    let after_scheme = without_git
        .split_once("://")
        .map_or(without_git, |(_, rest)| rest);
    // Whatever follows the host: a slash everywhere, or the colon the `git@host:owner/repo` form uses.
    let (_, path) = after_scheme.split_once(['/', ':'])?;
    let name = path
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())?;
    let plain = !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':'])
        && !name.starts_with('-');
    plain.then(|| name.to_string())
}

/// Whether this exact folder is a git repository's own top level -- not a folder sitting inside one. Every write below refuses unless this holds, so a command run in a vault can never reach up and rewrite the repository it happens to live inside. That is the failure that pointed a vault's "change repo" at the wrong place and left the parent repo staring at unrelated histories.
fn is_repo_root(root: &Path) -> bool {
    matches!(git(root, &["rev-parse", "--show-toplevel"]), Ok(top) if same_folder(&top, root))
}

/// Point an already-initialized repository at a URL the user gave. Only sets the address -- it does **not** push. Sending the vault's contents somewhere is a separate, deliberate Sync, so merely naming a repository can never overwrite what is already in it or tangle two unrelated histories together.
pub fn link_vault_remote(root: &Path, url: &str) -> Result<(), GitError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(GitError::new("link remote", "no address given"));
    }
    if !is_repo_root(root) {
        return Err(GitError::new(
            "link remote",
            "this folder is not its own repository",
        ));
    }
    // Replace rather than add: pointing an existing origin somewhere else is the likelier intent, and `remote add` on a taken name just errors.
    if git_ok(root, &["remote", "get-url", "origin"]) {
        git(root, &["remote", "set-url", "origin", url])?;
    } else {
        git(root, &["remote", "add", "origin", url])?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Syncing
// ---------------------------------------------------------------------------

/// Commit whatever changed, take what is on the remote, then send it all back.
///
/// A rebase that hits a conflict is undone before returning. There is no merge view in a reader, and leaving someone mid-rebase in a folder they opened to read is worse than telling them to go and sort it out in git.
pub fn sync_vault_repo(root: &Path) -> Result<SyncReport, GitError> {
    let mut report = SyncReport::default();

    if !is_repo_root(root) {
        // Committing here would sweep up the enclosing repository's changes, not the vault's. Refuse rather than commit the wrong things.
        return Err(GitError::new(
            "sync",
            "this folder is not its own repository",
        ));
    }

    let status = git(root, VAULT_STATUS_ARGS)?;
    report.committed = count_changes(&status);
    if report.committed > 0 {
        git(root, &["add", "-A"])?;
        if staged_index_has_changes(root)? {
            git(root, &["commit", "-m", &commit_message(&status)])?;
        } else {
            report.committed = 0;
        }
    }

    let tracking = git_ok(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]);
    if tracking {
        if let Err(error) = git(root, &["pull", "--rebase"]) {
            // Put the tree back the way it was found.
            let _ = git(root, &["rebase", "--abort"]);
            return Err(error);
        }
        report.pulled = true;
    }

    push(root)?;
    report.pushed = true;
    Ok(report)
}

/// Push, setting the upstream when the branch has none — which is every branch the app itself created.
fn push(root: &Path) -> Result<(), GitError> {
    if git_ok(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
        return git(root, &["push"]).map(|_| ());
    }
    let branch = git(root, &["branch", "--show-current"])?;
    if branch.is_empty() {
        return Err(GitError::new("push", "no branch is checked out"));
    }
    git(root, &["push", "-u", "origin", &branch]).map(|_| ())
}

// ---------------------------------------------------------------------------
// Reading what the tools print
// ---------------------------------------------------------------------------

/// `rev-list --left-right --count @{upstream}...HEAD` prints "behind<TAB>ahead". Left is the upstream side, so left is what we are missing.
pub(crate) fn parse_ahead_behind(counts: &str) -> (usize, usize) {
    let mut parts = counts.split_whitespace();
    let behind = parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
    let ahead = parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
    (behind, ahead)
}

/// Lines of `status --porcelain`, which is one per changed path.
pub(crate) fn count_changes(status: &str) -> usize {
    status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
}

/// A commit message describing the change rather than the tool that made it. One file is named; several are counted. The app's name is deliberately absent — it is the user's history, and they did the writing.
pub(crate) fn commit_message(status: &str) -> String {
    let paths: Vec<&str> = status
        .lines()
        .filter_map(|line| porcelain_path(line))
        .collect();
    match paths.as_slice() {
        [] => "Update the vault".to_string(),
        [single] => format!("Update {single}"),
        many => format!("Update {} files", many.len()),
    }
}

/// The path out of a porcelain line: two status columns, a space, then the path. A rename prints `old -> new`; the new name is the one worth reporting.
///
/// Cut at two and trim, which lands on the path whether or not the leading status blank survived. A fixed three drops the first letter silently.
fn porcelain_path(line: &str) -> Option<&str> {
    let rest = line.get(2..)?.trim();
    if rest.is_empty() {
        return None;
    }
    Some(match rest.rsplit_once(" -> ") {
        Some((_, new)) => new,
        None => rest,
    })
    .map(|path| path.trim_matches('"'))
}

/// `owner/name` out of a remote URL, in any of the forms git accepts. Anything unrecognized is shown as it is rather than guessed at.
pub(crate) fn remote_label(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    let without_git = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    // scp-style: git@github.com:owner/name
    if let Some((_, path)) = without_git.split_once(':') {
        if !path.starts_with('/') && without_git.contains('@') {
            return path.to_string();
        }
    }
    // https://host/owner/name — keep the last two segments.
    let segments: Vec<&str> = without_git
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.len() >= 2 && without_git.contains("://") {
        return segments[segments.len() - 2..].join("/");
    }
    without_git.to_string()
}

/// A vault's name as a repository name: what GitHub will accept, and what the user will recognize afterwards.
pub fn repo_name_for_vault(vault_name: &str) -> String {
    let mut out = String::with_capacity(vault_name.len());
    let mut last_dash = true;
    for character in vault_name.chars() {
        if character.is_ascii_alphanumeric() || character == '.' || character == '_' {
            out.push(character);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches(['-', '.']).to_string();
    if trimmed.is_empty() {
        "vault".to_string()
    } else {
        trimmed
    }
}

/// The lines to add to a `.gitignore` for nested repositories, skipping any the file already names. Carries the reason with it: the next person to read the file should not have to work out why a folder is missing.
pub(crate) fn gitignore_addition(existing: &str, nested: &[String]) -> String {
    let already: Vec<&str> = existing
        .lines()
        .map(|line| line.trim().trim_end_matches('/'))
        .collect();
    let missing: Vec<&String> = nested
        .iter()
        .filter(|path| !already.contains(&path.trim_end_matches('/')))
        .collect();
    if missing.is_empty() {
        return String::new();
    }
    let mut out = String::from(
        "\n# Repositories with their own remotes. Tracking one from out here\n\
         # records a pointer to a commit nobody else can resolve.\n",
    );
    for path in missing {
        out.push_str(path);
        out.push_str("/\n");
    }
    out
}

/// The first line worth showing out of a tool's complaint. git narrates a push to stderr -- the destination URL, the remote's progress -- before it says what went wrong, and those lines read like success ("To github.com/..."). So skip the narration and the terminal-only advice, and land on the sentence that actually names the problem.
fn first_useful_line(detail: &str) -> String {
    let is_noise = |line: &str| {
        line.is_empty()
            || line.starts_with("hint:")
            || line.starts_with("remote:")
            || line.starts_with("To ")
            || line.starts_with("From ")
    };
    detail
        .lines()
        .map(str::trim)
        .find(|line| !is_noise(line))
        .unwrap_or("")
        .trim_start_matches("fatal: ")
        .trim_start_matches("error: ")
        .to_string()
}

/// A failed git call as the one line the panel reports: a tag naming which of its own fixes to press where git's words name one, and git's own words where they name neither. A tag rather than a sentence for the same reason `created` and `linked` are tags — the words belong with the rest of the panel's words, in the page.
pub fn failure_message(error: &GitError) -> String {
    match failure_cause(&error.detail) {
        Some(cause) => format!("failed:{cause}"),
        None => error.to_string(),
    }
}

/// Which of the panel's own fixes a failed git call points at, where git's words name one. `None` where they name neither, and that is the common case on purpose: a network that is down, a remote that has moved ahead and a repository that is not there all fail here, none of them has a button in the panel, and dressing one up as a sign-in problem would send somebody to press the wrong thing.
///
/// Read against what git prints under the app's own environment, already through [`first_useful_line`] — so the `remote:` and `hint:` lines are gone and the identity case is down to its first line, `Author identity unknown`, with git's three-paragraph lecture cut off behind it.
pub(crate) fn failure_cause(detail: &str) -> Option<&'static str> {
    let said = detail.to_ascii_lowercase();
    if said.contains("authentication failed")
        || said.contains("terminal prompts disabled")
        || said.contains("permission denied (publickey)")
    {
        return Some("signin");
    }
    if said.contains("author identity unknown")
        || said.contains("empty ident name")
        || said.contains("unable to auto-detect email address")
    {
        return Some("identity");
    }
    None
}

/// Whether git's answer names the same folder we asked about. git prints forward slashes on Windows and may resolve a link, so compare canonically and fall back to a textual match.
fn same_folder(reported: &str, root: &Path) -> bool {
    let reported = PathBuf::from(reported);
    match (
        std::fs::canonicalize(&reported),
        std::fs::canonicalize(root),
    ) {
        (Ok(left), Ok(right)) => left == right,
        _ => reported == root,
    }
}

/// A descendant's path relative to the vault, in the form a `.gitignore` wants.
fn relative_label(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let text = relative.to_string_lossy().replace('\\', "/");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}
