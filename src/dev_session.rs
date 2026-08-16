//! What makes one development launch a copy of its own.
//!
//! Two private source trees still launch into one running app: the Windows instance slot, both pipes, the settings, the WebView data and the journal are all per user, so a second copy forwards to the first and both write one profile. A managed workspace launcher answers that by naming its session in the environment, and **this is the only thing that reads the value** — the paths and the process names ask here instead, so there is one answer to what a development launch is and one place that decides a value is safe.
//!
//! Absent, or holding anything this cannot vouch for, there is no override at all: every installed path and every process name is byte-for-byte what it was. That is the whole contract with installed copies, whose settings, recent files and vault registry sit at paths nothing may move.

use std::path::PathBuf;
use std::sync::OnceLock;

/// Set by the managed workspace launcher and by nothing else. An installed copy never has it.
const DEV_SESSION_VAR: &str = "LEAFTEXT_DEV_SESSION";

/// As long as a session may be. A workspace session is a host session id, which is 36 characters, so this leaves room while keeping a Windows pipe name well inside the 256 the platform takes.
const MAX_SESSION_LEN: usize = 64;

/// One development launch's private identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevSession(String);

impl DevSession {
    /// The session a value names, or `None` for anything a folder name and a Win32 object name may not both hold. Refused whole rather than cleaned up: a value this cannot vouch for leaves the launch on the installed identity, which is the safe answer, where a scrubbed one would quietly point a development copy at somebody's real profile.
    pub fn parse(raw: &str) -> Option<Self> {
        let id = raw.trim();
        if id.is_empty() || id.len() > MAX_SESSION_LEN {
            return None;
        }
        if !id
            .chars()
            .all(|letter| letter.is_ascii_alphanumeric() || letter == '-')
        {
            return None;
        }
        Some(Self(id.to_string()))
    }

    /// The session itself, which is the last part of its private folder.
    pub fn id(&self) -> &str {
        &self.0
    }

    /// What a process name gains, so a development copy claims its own instance slot and its own pipes instead of handing its file to whatever is already up.
    pub fn name_suffix(&self) -> String {
        format!("-dev-{}", self.0)
    }
}

/// Where a session's private pair of checkouts is made. The tools that address a running copy read the same folder, and the override exists so a self-test gets a folder of its own.
const WORKSPACES_VAR: &str = "LEAFTEXT_WORKSPACES";
const WORKSPACES_DIR: &str = ".leaftext-workspaces";

/// This launch's session. Read once: a value that changed mid-run would move the settings and the journal out from under an open window.
pub fn dev_session() -> Option<&'static DevSession> {
    static SESSION: OnceLock<Option<DevSession>> = OnceLock::new();
    SESSION
        .get_or_init(|| {
            std::env::var(DEV_SESSION_VAR)
                .ok()
                .as_deref()
                .and_then(DevSession::parse)
                .or_else(|| session_of(std::env::current_exe().ok()?.as_path()))
        })
        .as_ref()
}

/// The session a running copy belongs to, read off where it was built.
///
/// Nothing has to be set for this to hold, which is the point: there is no command that opens a copy, so a launch from a session's own checkout would otherwise carry no session and answer on the name every other copy is using. An installed copy and an ordinary local build sit nowhere near the workspace folder, so both derive nothing and keep the identity they have always had.
fn session_of(exe: &std::path::Path) -> Option<DevSession> {
    let parent = std::env::var_os(WORKSPACES_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    // From the folder the program sits in: the program itself is a file, and a file dropped straight into the workspace parent names no session.
    for dir in exe.ancestors().skip(1) {
        let under = match &parent {
            Some(root) => dir.parent() == Some(root.as_path()),
            None => {
                dir.parent().and_then(|up| up.file_name())
                    == Some(std::ffi::OsStr::new(WORKSPACES_DIR))
            }
        };
        if under {
            return DevSession::parse(&dir.file_name()?.to_string_lossy());
        }
    }
    None
}

/// What this launch's process names carry — the empty string for every normal launch, which is what keeps those names unchanged.
pub fn dev_name_suffix() -> String {
    dev_session()
        .map(DevSession::name_suffix)
        .unwrap_or_default()
}

/// A development session's whole profile, in one folder, so removing a workspace's copy is removing one thing.
///
/// Windows keeps roaming settings apart from local data, and the development root sits in the local half for both: a session's copy is scratch, and splitting it across two roots would leave half of it behind. macOS draws no such distinction, so the folder is under the one Application Support directory the app already owns.
fn dev_root(session: &DevSession) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Some(
            PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
                .join(crate::APP_ORGANIZATION)
                .join(crate::APP_NAME)
                .join("dev")
                .join(session.id()),
        )
    }
    #[cfg(target_os = "macos")]
    {
        Some(
            crate::macos_application_support_dir()?
                .join("dev")
                .join(session.id()),
        )
    }
}

/// Reachable from the test tree so the rule can be proved against made-up paths rather than against wherever this machine happens to have built.
#[cfg(test)]
pub(crate) fn session_of_exe(exe: &std::path::Path) -> Option<DevSession> {
    session_of(exe)
}

/// A development session's settings and recent files. Split from its data on Windows and the same folder on macOS, which is the shape the installed roots have — so a fault that only appears where the two roots are one folder still appears in a development copy.
pub(crate) fn dev_config_dir(session: &DevSession) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Some(dev_root(session)?.join("config"))
    }
    #[cfg(target_os = "macos")]
    {
        dev_root(session)
    }
}

/// A development session's vault registry, WebView data, staged updates and journal.
pub(crate) fn dev_data_local_dir(session: &DevSession) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Some(dev_root(session)?.join("data"))
    }
    #[cfg(target_os = "macos")]
    {
        dev_root(session)
    }
}
