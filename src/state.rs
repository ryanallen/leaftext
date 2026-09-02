use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{read_source, ScrollAnchor};

/// How deep the history the start screen scrolls goes. Past what anyone scrolls, and still a file of a few KB rewritten whole on every open. Not uncapped: that is [`Favorites`]' rule on purpose — a favorite is a decision, a recent is a rolling record of what happened.
pub(crate) const MAX_RECENT_FILES: usize = 50;
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentFiles {
    pub files: Vec<PathBuf>,
}

impl RecentFiles {
    pub fn record(&mut self, path: PathBuf) {
        let path = normalize_recent_path(&path);
        self.files.retain(|existing| existing != &path);
        self.files.insert(0, path);
        self.files.truncate(MAX_RECENT_FILES);
    }

    /// Drop `path` from the list (e.g. it no longer exists, so it should stop being offered). Returns whether it was present.
    pub fn forget(&mut self, path: &Path) -> bool {
        let path = normalize_recent_path(path);
        let before = self.files.len();
        self.files.retain(|existing| existing != &path);
        before != self.files.len()
    }

    /// Collapse entries to normalized form, dropping duplicates in order. Run on load so the same file recorded under different spellings self-heals.
    pub(crate) fn normalize_entries(&mut self) {
        let mut normalized: Vec<PathBuf> = Vec::with_capacity(self.files.len());
        for path in self.files.drain(..) {
            let path = normalize_recent_path(&path);
            if !normalized.contains(&path) {
                normalized.push(path);
            }
        }
        self.files = normalized;
    }
}

/// What a favorite points at. A folder can be favorited too, so a shortcut to one is the same store rather than a second list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FavoriteKind {
    Document,
    Folder,
}

/// One favorite, with the vault it was marked inside. `vault_id` is `None` for something outside every vault — drawn in its own group rather than refused, since a file on the desktop is still a file you can favorite.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    #[serde(default)]
    pub vault_id: Option<i64>,
    pub path: PathBuf,
    pub kind: FavoriteKind,
}

/// The favorites, in the order the user put them in. Unlike [`RecentFiles`] there is no cap and nothing but the user takes an entry out: a recent is a record of what happened, and this is a decision somebody made.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Favorites {
    pub entries: Vec<Favorite>,
}

impl Favorites {
    /// Favorite `favorite`, at the end of the list. Returns whether it was added; marking something twice is not an error and never moves it.
    pub fn add(&mut self, favorite: Favorite) -> bool {
        let favorite = Favorite {
            path: normalize_recent_path(&favorite.path),
            ..favorite
        };
        if self.entries.iter().any(|one| one.path == favorite.path) {
            return false;
        }
        self.entries.push(favorite);
        true
    }

    /// Unfavorite `path`. Returns whether it was there, so the save is skipped when nothing changed.
    pub fn remove(&mut self, path: &Path) -> bool {
        let path = normalize_recent_path(path);
        let before = self.entries.len();
        self.entries.retain(|one| one.path != path);
        before != self.entries.len()
    }

    pub fn contains(&self, path: &Path) -> bool {
        let path = normalize_recent_path(path);
        self.entries.iter().any(|one| one.path == path)
    }

    /// Move the entry at `from` so it sits at `to`. An index the list does not have changes nothing, so a drop the page mis-measured cannot scramble the order.
    pub fn reorder(&mut self, from: usize, to: usize) -> bool {
        if from == to || from >= self.entries.len() || to >= self.entries.len() {
            return false;
        }
        let entry = self.entries.remove(from);
        self.entries.insert(to, entry);
        true
    }

    /// Point the favorite at `from` at `to`, keeping its place in the list. Returns whether `from` was there — a path the list does not hold changes nothing, so an answer about a row that has since been unfavorited cannot put one back. `remove` then `add` would land it at the end instead, which loses the order the user set. The vault is the registry's answer about the new path, not the old entry's: a file that really moved to another vault belongs to that vault's group.
    pub fn repoint(&mut self, from: &Path, to: &Path, vault_id: Option<i64>) -> bool {
        let from = normalize_recent_path(from);
        let to = normalize_recent_path(to);
        let Some(at) = self.entries.iter().position(|one| one.path == from) else {
            return false;
        };
        // Already a favorite somewhere else in the list: repointing here would hold one path twice, so the repaired row goes and the entry that was already there keeps its own place.
        if self
            .entries
            .iter()
            .enumerate()
            .any(|(index, one)| index != at && one.path == to)
        {
            self.entries.remove(at);
            return true;
        }
        self.entries[at].path = to;
        self.entries[at].vault_id = vault_id;
        true
    }

    /// Move the favorite at `path` so it sits directly before the one at `before`, or last when there is none. Paths rather than positions, because the list the page draws is grouped by vault and can still be drawing a row that has left the store — so a drawn index is not one of these. Either path being absent changes nothing.
    pub fn move_before(&mut self, path: &Path, before: Option<&Path>) -> bool {
        let path = normalize_recent_path(path);
        let Some(from) = self.entries.iter().position(|one| one.path == path) else {
            return false;
        };
        let to = match before {
            Some(before) => {
                let before = normalize_recent_path(before);
                let Some(at) = self.entries.iter().position(|one| one.path == before) else {
                    return false;
                };
                // Landing before a row further down: taking this one out first shifts that row up by one, and inserting at its old index would drop this one after it.
                if from < at {
                    at - 1
                } else {
                    at
                }
            }
            None => self.entries.len() - 1,
        };
        self.reorder(from, to)
    }

    /// Unfavorite everything marked inside `vault_id`, for a vault being removed. The registry is the only record of what that id meant, so keeping them would leave paths nobody can name.
    pub fn forget_vault(&mut self, vault_id: i64) -> bool {
        let before = self.entries.len();
        self.entries.retain(|one| one.vault_id != Some(vault_id));
        before != self.entries.len()
    }

    /// Collapse entries to normalized form, dropping duplicates in order. Run on load, like Recent's, so the same path favorited under two spellings self-heals.
    fn normalize_entries(&mut self) {
        let mut normalized: Vec<Favorite> = Vec::with_capacity(self.entries.len());
        for entry in self.entries.drain(..) {
            let entry = Favorite {
                path: normalize_recent_path(&entry.path),
                ..entry
            };
            if !normalized.iter().any(|one| one.path == entry.path) {
                normalized.push(entry);
            }
        }
        self.entries = normalized;
    }
}

/// Resolve `.` and `..` in `path` lexically (not via the filesystem) so two spellings of the same file collapse to one entry in Recent or in the favorites. Lexical rather than canonicalized keeps the path human-readable (no `\\?\` prefix) and usable by OS file-reveal commands.
fn normalize_recent_path(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            // Only pop a real segment; a `..` that escapes the root can't be resolved lexically, so keep it verbatim.
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    if normalized.as_os_str().is_empty() {
        path.to_path_buf()
    } else {
        normalized
    }
}

/// Reverse-DNS app id, and the two halves it is built from. macOS names the per-app folder with the whole id; Windows nests organization inside application. Both spellings are load-bearing: they are where every existing install already keeps its settings, recent files, and vault registry. Only macOS spells the qualifier into a path; Windows ignores it entirely.
#[cfg(target_os = "macos")]
const APP_QUALIFIER: &str = "com";
#[cfg(feature = "desktop")]
const APP_ORGANIZATION: &str = "ryanallen";
#[cfg(feature = "desktop")]
const APP_NAME: &str = "leaftext";

/// Roaming per-user configuration root: settings and recent files.
#[cfg(feature = "desktop")]
pub fn project_config_dir() -> Option<PathBuf> {
    installed_config_dir()
}

/// Where an installed copy keeps its settings and recent files.
///
/// Windows: `%APPDATA%\ryanallen\leaftext\config`. macOS: `~/Library/Application Support/com.ryanallen.leaftext`.
///
/// These reproduce, exactly, the layout the `directories` crate produced for `ProjectDirs::from("com", "ryanallen", "leaftext")` — including the `config` leaf on Windows, which is easy to miss and would strand every existing user's settings if it were dropped. `project_dirs_match_the_documented_layout` pins both.
#[cfg(feature = "desktop")]
pub(crate) fn installed_config_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Some(
            PathBuf::from(std::env::var_os("APPDATA")?)
                .join(APP_ORGANIZATION)
                .join(APP_NAME)
                .join("config"),
        )
    }
    #[cfg(target_os = "macos")]
    {
        Some(macos_application_support_dir()?)
    }
}

/// Machine-local per-user data root: WebView2's cache, the vault registry, staged updates and the journal.
#[cfg(feature = "desktop")]
pub fn project_data_local_dir() -> Option<PathBuf> {
    installed_data_local_dir()
}

/// Where an installed copy keeps that data.
///
/// Windows: `%LOCALAPPDATA%\ryanallen\leaftext\data`. macOS: `~/Library/Application Support/com.ryanallen.leaftext`, which is the same folder as the config root — the platform draws no roaming distinction.
#[cfg(feature = "desktop")]
pub(crate) fn installed_data_local_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Some(
            PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
                .join(APP_ORGANIZATION)
                .join(APP_NAME)
                .join("data"),
        )
    }
    #[cfg(target_os = "macos")]
    {
        Some(macos_application_support_dir()?)
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_application_support_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").filter(|home| !home.is_empty())?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(format!("{APP_QUALIFIER}.{APP_ORGANIZATION}.{APP_NAME}")),
    )
}

#[cfg(feature = "desktop")]
pub fn config_file_path() -> Option<PathBuf> {
    project_config_dir().map(|dir| dir.join("recent-files.json"))
}

#[cfg(feature = "desktop")]
pub fn webview_user_data_dir() -> Option<PathBuf> {
    project_data_local_dir().map(|dir| dir.join("webview2"))
}

/// The app data root for leaftext's own files: `manifest.db` (the vault registry) and staged updates. The local data dir itself, not the WebView2 cache subfolder, so neither is entangled with the browser's storage.
#[cfg(feature = "desktop")]
pub fn app_data_dir() -> Option<PathBuf> {
    project_data_local_dir()
}

/// Read one of our own JSON config files as text.
///
/// Goes through [`read_source`] for the byte order mark: PowerShell and Notepad write one by default, `serde_json` refuses a document that starts with one, and every reader here falls back to defaults on a parse failure — so without this a settings file someone edited by hand on Windows is silently thrown away.
///
/// Unlike a document, the spelling is dropped rather than kept. These are the app's own files, rewritten whole by [`save_settings`] and [`save_recent_files`] in UTF-8, and no authored text is at stake in one.
fn read_config_text(path: impl AsRef<Path>) -> io::Result<String> {
    Ok(read_source(path)?.text)
}

/// Both lists in the config file. They share one file, so each save reads what is on disk and replaces only its own half; a file written before favorites existed loads with an empty one.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct ConfigLists {
    files: Vec<PathBuf>,
    favorites: Favorites,
}

fn read_config_lists(config_path: impl AsRef<Path>) -> ConfigLists {
    read_config_text(config_path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn write_config_lists(config_path: impl AsRef<Path>, lists: &ConfigLists) -> io::Result<()> {
    let config_path = config_path.as_ref();
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(lists)?;
    fs::write(config_path, json)
}

pub fn load_recent_files(config_path: impl AsRef<Path>) -> RecentFiles {
    let mut recent = RecentFiles {
        files: read_config_lists(config_path).files,
    };
    recent.normalize_entries();
    recent
}

pub fn save_recent_files(config_path: impl AsRef<Path>, recent: &RecentFiles) -> io::Result<()> {
    let mut lists = read_config_lists(&config_path);
    lists.files.clone_from(&recent.files);
    write_config_lists(config_path, &lists)
}

pub fn load_favorites(config_path: impl AsRef<Path>) -> Favorites {
    let mut favorites = read_config_lists(config_path).favorites;
    favorites.normalize_entries();
    favorites
}

pub fn save_favorites(config_path: impl AsRef<Path>, favorites: &Favorites) -> io::Result<()> {
    let mut lists = read_config_lists(&config_path);
    lists.favorites.clone_from(favorites);
    write_config_lists(config_path, &lists)
}

/// One tab the app puts back after a restart. It is deliberately only the document now showing, not the tab's Back list.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionTab {
    pub path: PathBuf,
    pub title: String,
    pub code_view: bool,
    pub anchor: Option<ScrollAnchor>,
    pub saved_code_scroll: Option<f64>,
    /// Whether this entry is a note that never got a file, so there is nothing to reopen and the words below are the whole document. A flag of its own rather than a test on the path: the name a new note wears is a bare relative one, so asking whether it is a file resolves it against the folder the app was started in, and an `Untitled.md` sitting there would come back in place of the note.
    pub untitled: bool,
    /// The unsaved buffer as it stood when the window closed, so the edits come back rather than being discarded without a word. `None` for a clean tab, and written by the close alone — a mid-run save would rewrite this file at every pause in typing.
    pub unsaved_text: Option<String>,
    /// The same tab's text as it was last written to disk, which is what the next launch compares the file against before it puts the buffer back. The text rather than a hash: the app's own hash is per-run, so one written here would stop matching after every app update and silently drop the edits.
    pub saved_text: Option<String>,
}

/// The open workspace remembered in the app config. `active` is `None` when the home screen was showing.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Session {
    pub tabs: Vec<SessionTab>,
    pub active: Option<usize>,
}

/// UI toggles that survive a restart. The app shell's opaque origin can't use localStorage, so the host owns these: injected on boot via [`crate::initial_settings_script`] and saved whenever the frontend reports a change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// The open tabs and front tab from the last session.
    pub session: Session,
    /// Quiet prose and add bold lead anchors at word starts. Off by default.
    pub speed_reader_enabled: bool,
    /// The code view's typing help: note and heading suggestions, and the underline on links that lead nowhere. On by default.
    pub code_intel_enabled: bool,
    /// The padlocks, one per editable view: typing in the page and typing in the source are two different risks, so unlocking one is not consent to the other. Both off by default, the safe way round to be wrong.
    pub reading_unlocked: bool,
    pub code_unlocked: bool,
    /// Selected theme family: `github`/`nightshade`/`amaranth`/… Raw frontend string; the frontend normalizes anything unexpected back to `github`.
    pub theme_family: String,
    /// Last appearance mode: `system`/`light`/`dark`/`daylight`. Raw frontend string; the frontend normalizes anything unexpected back to `system`.
    pub theme_mode: String,
    /// Families already shown in the current random-theme cycle. When the theme family is `random`, the frontend draws a fresh family at each launch and appends it here so none repeats until every family has shown, then resets.
    pub theme_random_used: Vec<String>,
    /// How much of the link graph the graph view draws (see [`GraphScope`]).
    pub graph_scope: GraphScope,
    /// The folder the library pane is inside (empty string = the root). Restored on launch, so the pane reopens where it was left.
    pub library_project_path: String,
    /// Whether the library pane is collapsed shut. Open by default.
    pub library_closed: bool,
    /// The pane's last open width in CSS px. The frontend re-clamps it to the window, so it's a preference, not a command.
    pub library_width: u32,
    /// The window's last inner size in logical px, so it reopens where the user left it. Logical so it round-trips across monitors of different scale.
    pub window_width: u32,
    pub window_height: u32,
    /// Whether the window was maximized at last close. Tracked apart from the size so un-maximizing returns to the windowed dimensions.
    pub window_maximized: bool,
    /// Unix seconds of the last release check, so launches don't each spend a request against GitHub's unauthenticated rate limit.
    pub update_last_checked: u64,
    /// Version of the verified installer waiting on disk, empty when none is.
    pub update_staged_version: String,
    /// Version the app already tried to install by itself at launch: one automatic attempt each, then the button. Without it, a failing installer boot-loops.
    #[serde(default)]
    pub update_auto_applied: String,
    /// Launches that had a first-run hint to draw. A launch whose target was not on screen is not counted, so the hint waits for one where it can be pointed at rather than being spent on a shut pane.
    pub hint_launches: u32,
    /// First-run hints already met — the pointer reached the control the bubble pointed at, or it was pressed. A name in here never shows again on this install.
    pub hints_seen: Vec<String>,
    /// The launch count the last bubble showed at, so the next hint waits out a quiet launch. One number for every hint, because only one bubble can show in a launch.
    pub hint_last_launch: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            session: Session::default(),
            speed_reader_enabled: false,
            code_intel_enabled: true,
            reading_unlocked: false,
            code_unlocked: false,
            theme_family: "random".to_string(),
            theme_mode: "daylight".to_string(),
            theme_random_used: Vec::new(),
            graph_scope: GraphScope::default(),
            library_project_path: String::new(),
            library_closed: false,
            library_width: 240,
            window_width: 1080,
            window_height: 820,
            window_maximized: false,
            update_last_checked: 0,
            update_staged_version: String::new(),
            update_auto_applied: String::new(),
            hint_launches: 0,
            hints_seen: Vec::new(),
            hint_last_launch: 0,
        }
    }
}

/// How much of the link graph the graph view draws. `Small` focuses on the open document (or recents on the start screen) plus everything one link away; the rest cap the densest documents at increasing sizes up to `Xl` (everything). Serialized lowercase to match `GRAPH_SCOPES`. Small is the default.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphScope {
    #[default]
    Small,
    Medium,
    Large,
    Xl,
}

impl GraphScope {
    pub fn as_str(self) -> &'static str {
        match self {
            GraphScope::Small => "small",
            GraphScope::Medium => "medium",
            GraphScope::Large => "large",
            GraphScope::Xl => "xl",
        }
    }

    /// Parse a value sent by the frontend, ignoring anything unrecognized.
    pub fn from_client(value: &str) -> Option<Self> {
        match value {
            "small" => Some(GraphScope::Small),
            "medium" => Some(GraphScope::Medium),
            "large" => Some(GraphScope::Large),
            "xl" => Some(GraphScope::Xl),
            _ => None,
        }
    }
}

#[cfg(feature = "desktop")]
pub fn settings_file_path() -> Option<PathBuf> {
    project_config_dir().map(|dir| dir.join("settings.json"))
}

/// What [`load_settings`] found. An unreadable file and no file at all both end in [`Settings::default()`], so without this flag the app opens factory-fresh with nothing to say that someone's saved choices were skipped.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SettingsLoad {
    pub settings: Settings,
    /// A file was there and did not parse — false for the ordinary first launch.
    pub unreadable: bool,
}

/// Load the persisted UI toggles, falling back to defaults when the file is missing or corrupt.
pub fn load_settings(settings_path: impl AsRef<Path>) -> SettingsLoad {
    let text = read_config_text(settings_path);
    let parsed: Option<Settings> = text
        .as_ref()
        .ok()
        .and_then(|contents| serde_json::from_str(contents).ok());
    // Read but not parsed: the file is there and we are about to ignore it.
    let unreadable = text.is_ok() && parsed.is_none();
    let mut settings = parsed.unwrap_or_default();
    // Migrate the pre-family single-axis setting: Dracula used to be a theme "mode"; it's now the dark half of the Nightshade family (the renamed Dracula palette).
    if settings.theme_mode == "dracula" {
        settings.theme_family = "nightshade".to_string();
        settings.theme_mode = "dark".to_string();
    }
    SettingsLoad {
        settings,
        unreadable,
    }
}

pub fn save_settings(settings_path: impl AsRef<Path>, settings: &Settings) -> io::Result<()> {
    let settings_path = settings_path.as_ref();
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(settings)?;
    fs::write(settings_path, json)
}
