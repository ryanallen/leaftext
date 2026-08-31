//! The install written down before any of it happens: every file, every registry value, the one shortcut and the Installed Apps record, as data.
//!
//! Nothing here touches a disk or a registry, which is the point — the whole of what the installer does can be read, and asserted against, on a machine that never runs it. `apply.rs` is the only thing that lays it down, and it adds nothing of its own.
//!
//! It has to produce the same install the MSI produces: same folder, same HKCU values, same single Start Menu entry, same file associations. `wix/main.wxs` is the other half of that pair, and the two are held together by `installer_claims_every_readable_extension` in the app's tests.

use std::path::{Path, PathBuf};

/// What Installed Apps and the Start Menu call it.
pub const PRODUCT_NAME: &str = "Leaftext";
pub const PUBLISHER: &str = "ryanallen";

/// The document class every claimed extension points at.
pub const PROGID: &str = "LeafText.Document";

/// The app's own key: the folder to reinstate on an upgrade, the marker saying which installer put this copy here, and the Default Programs registration all hang off it.
pub const APP_KEY: &str = r"Software\ryanallen\leaftext";

/// Where the remembered install folder lives, under `APP_KEY`. `wix/main.wxs` searches for this same name, so a copy installed by either file upgrades into the folder the other one chose.
pub const INSTALL_FOLDER_VALUE: &str = "InstallFolder";

/// Which installer put this copy on the machine, under `APP_KEY`. Absent means the MSI, because that is what every copy on disk today looks like — so the updater keeps handing an MSI install an MSI without anything being written for it.
pub const INSTALLED_BY_VALUE: &str = "InstalledBy";

/// What this installer writes there.
pub const INSTALLED_BY_EXE: &str = "exe";

/// The Installed Apps record. Uninstalling from Settings runs what this key names.
pub const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Leaftext";

/// The app, under the install folder. Same shape as the MSI's `bin` directory, so both installers leave the executable at the same path.
pub const APP_RELATIVE_PATH: &str = r"bin\leaftext.exe";

/// The installer keeps a copy of itself here to be the uninstaller: the Installed Apps record has to name a program that outlives the install.
pub const UNINSTALLER_RELATIVE_PATH: &str = "leaftext-setup.exe";

/// Every extension the app reads, claimed in the same three registry shapes `wix/main.wxs` uses. `src/format.rs` is the source; `installer_claims_every_readable_extension` fails when this list falls behind it.
pub const EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mdc", "xml", "json", "yaml", "yml", "eml", "mht", "mhtml", "html",
    "htm", "txt", "ini", "ts", "tsx", "js", "jsx", "jsonc", "css", "scss", "sh", "bash", "zsh",
    "toml", "rs", "py", "sql", "diff", "patch", "env", "graphql", "gql",
];

/// Readable extensions Leaftext may claim where no default exists. HTML stays with the browser, and plain text with whatever already opens it, unless a person chooses Leaftext.
pub const OWNED_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mdc", "xml", "json", "yaml", "yml", "eml", "mht", "mhtml",
];

/// The only registry root anything here writes. A per-user install cannot write `HKLM` and does not need to, and one variant is what makes that provable rather than remembered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Root {
    CurrentUser,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Data {
    String(String),
    Dword(u32),
}

/// One registry value. `name` is `None` for a key's default value, which is how a document class names itself and how a shell command is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Value {
    pub root: Root,
    pub key: String,
    pub name: Option<String>,
    pub data: Data,
}

impl Value {
    fn string(key: &str, name: Option<&str>, data: impl Into<String>) -> Self {
        Self {
            root: Root::CurrentUser,
            key: key.to_string(),
            name: name.map(str::to_string),
            data: Data::String(data.into()),
        }
    }

    fn dword(key: &str, name: &str, data: u32) -> Self {
        Self {
            root: Root::CurrentUser,
            key: key.to_string(),
            name: Some(name.to_string()),
            data: Data::Dword(data),
        }
    }
}

/// Where a file's bytes come from. The app is carried inside the installer; the uninstaller is the installer itself, copied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Content {
    App,
    Uninstaller,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct File {
    pub path: PathBuf,
    pub content: Content,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shortcut {
    pub path: PathBuf,
    pub target: PathBuf,
    pub working_directory: PathBuf,
    pub description: String,
}

/// Everything the install is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// Created on install, and removed on uninstall in this order reversed — deepest first, and only when empty, so a folder somebody else's app shares is never disturbed.
    pub folders: Vec<PathBuf>,
    pub files: Vec<File>,
    pub shortcuts: Vec<Shortcut>,
    pub values: Vec<Value>,
    /// Keys this install owns outright, removed whole on uninstall. Anything not listed here has its values removed one at a time, because a key like `Software\Classes\.md` may have been there before the app and must survive it.
    pub owned_keys: Vec<String>,
}

impl Plan {
    /// Every absolute path the install writes to: the files, the folders and the shortcut. What the whole of it touches, in one list, so the test asserting all of it is inside the user's own folder has one thing to ask.
    #[cfg(test)]
    pub fn written_paths(&self) -> Vec<&Path> {
        self.folders
            .iter()
            .map(PathBuf::as_path)
            .chain(self.files.iter().map(|file| file.path.as_path()))
            .chain(self.shortcuts.iter().map(|link| link.path.as_path()))
            .collect()
    }
}

/// Build the plan for installing `version` into `folder`, with the Start Menu entry in `start_menu`.
///
/// Both folders are handed in rather than looked up, so the whole plan is a function of its arguments and a test can point it at a temporary root.
pub fn plan(folder: &Path, start_menu: &Path, version: &str) -> Plan {
    let executable = folder.join(APP_RELATIVE_PATH);
    let uninstaller = folder.join(UNINSTALLER_RELATIVE_PATH);
    let bin = folder.join("bin");
    let executable_text = executable.display().to_string();
    let open_command = format!("\"{executable_text}\" \"%1\"");

    let mut values = vec![
        // The folder to reinstate on the next install, and the marker saying which file to update through.
        Value::string(
            APP_KEY,
            Some(INSTALL_FOLDER_VALUE),
            folder.display().to_string(),
        ),
        Value::string(APP_KEY, Some(INSTALLED_BY_VALUE), INSTALLED_BY_EXE),
        Value::dword(APP_KEY, "shortcut", 1),
        Value::dword(APP_KEY, "associations", 1),
        // The document class: name, icon, and how to open it. Index 0 is the executable's own leaf icon, so documents show it too.
        Value::string(
            &format!(r"Software\Classes\{PROGID}"),
            None,
            "Leaftext Document",
        ),
        Value::string(
            &format!(r"Software\Classes\{PROGID}"),
            Some("FriendlyTypeName"),
            "Leaftext Document",
        ),
        Value::string(
            &format!(r"Software\Classes\{PROGID}\DefaultIcon"),
            None,
            format!("\"{executable_text}\",0"),
        ),
        Value::string(
            &format!(r"Software\Classes\{PROGID}\shell\open\command"),
            None,
            &open_command,
        ),
        // Puts Leaftext in the "Open with" list even for extensions it does not own.
        Value::string(
            r"Software\Classes\Applications\leaftext.exe",
            Some("FriendlyAppName"),
            PRODUCT_NAME,
        ),
        Value::string(
            r"Software\Classes\Applications\leaftext.exe\shell\open\command",
            None,
            &open_command,
        ),
        // Default Programs, so the app is listed in Settings > Default apps rather than only reachable per file.
        Value::string(
            &format!(r"{APP_KEY}\Capabilities"),
            Some("ApplicationName"),
            PRODUCT_NAME,
        ),
        Value::string(
            &format!(r"{APP_KEY}\Capabilities"),
            Some("ApplicationDescription"),
            "Read Markdown, XML, JSON, YAML and email documents.",
        ),
        Value::string(
            r"Software\RegisteredApplications",
            Some(PRODUCT_NAME),
            format!(r"{APP_KEY}\Capabilities"),
        ),
    ];

    // Windows 8+ honors its own UserChoice above these keys. Only formats Leaftext may own receive the bare extension key; HTML is offered without taking a browser's place.
    for extension in OWNED_EXTENSIONS {
        values.push(Value::string(
            &format!(r"Software\Classes\.{extension}"),
            None,
            PROGID,
        ));
    }

    for extension in EXTENSIONS {
        values.push(Value::string(
            &format!(r"Software\Classes\.{extension}\OpenWithProgids"),
            Some(PROGID),
            "",
        ));
        values.push(Value::string(
            r"Software\Classes\Applications\leaftext.exe\SupportedTypes",
            Some(&format!(".{extension}")),
            "",
        ));
        values.push(Value::string(
            &format!(r"{APP_KEY}\Capabilities\FileAssociations"),
            Some(&format!(".{extension}")),
            PROGID,
        ));
    }

    // Installed Apps. Without this the app can be installed and never removed from Settings, which is a worse install than none.
    values.extend([
        Value::string(UNINSTALL_KEY, Some("DisplayName"), PRODUCT_NAME),
        Value::string(UNINSTALL_KEY, Some("DisplayVersion"), version),
        Value::string(UNINSTALL_KEY, Some("Publisher"), PUBLISHER),
        Value::string(
            UNINSTALL_KEY,
            Some("InstallLocation"),
            folder.display().to_string(),
        ),
        Value::string(
            UNINSTALL_KEY,
            Some("DisplayIcon"),
            format!("{executable_text},0"),
        ),
        Value::string(
            UNINSTALL_KEY,
            Some("UninstallString"),
            format!("\"{}\" --uninstall --silent", uninstaller.display()),
        ),
        Value::string(
            UNINSTALL_KEY,
            Some("HelpLink"),
            "https://github.com/ryanallen/leaftext",
        ),
        // There is no maintenance screen to reach, so Settings should not offer one.
        Value::dword(UNINSTALL_KEY, "NoModify", 1),
        Value::dword(UNINSTALL_KEY, "NoRepair", 1),
    ]);

    Plan {
        folders: vec![folder.to_path_buf(), bin.clone()],
        files: vec![
            File {
                path: executable,
                content: Content::App,
            },
            File {
                path: uninstaller,
                content: Content::Uninstaller,
            },
        ],
        shortcuts: vec![Shortcut {
            // Straight into the Start Menu's Programs folder rather than a subfolder, so there is one entry and no leftover folder to clean up. It is not optional: it is the only way to launch or find the app.
            path: start_menu.join(format!("{PRODUCT_NAME}.lnk")),
            target: folder.join(APP_RELATIVE_PATH),
            working_directory: bin,
            description: "Launch Leaftext".to_string(),
        }],
        values,
        owned_keys: vec![
            format!(r"Software\Classes\{PROGID}"),
            r"Software\Classes\Applications\leaftext.exe".to_string(),
            APP_KEY.to_string(),
            UNINSTALL_KEY.to_string(),
        ],
    }
}
