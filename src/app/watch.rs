//! Watching the open file and its folder, and reloading on change.

use super::*;

/// Turns filesystem changes into `UserEvent::FileChanged` for the active
/// document's directory (live-reload) and, in Project view, the browsed folder.
/// Watches the parent directory, not the file, to survive editors that save by
/// renaming a temp file over the original.
pub(crate) struct FileWatch {
    pub(crate) debouncer: Option<Debouncer<RecommendedWatcher>>,
    pub(crate) last_active: Option<PathBuf>,
    /// Directories currently registered with the watcher and their recursive
    /// mode; the diff against the desired set on each `sync` is (un)watched.
    pub(crate) watched: HashMap<PathBuf, RecursiveMode>,
    /// Hash of the contents last rendered for the active document, so a reload
    /// skips redundant work when a spurious event arrives for unchanged content.
    pub(crate) active_hash: Option<u64>,
}

impl FileWatch {
    pub(crate) fn new(proxy: EventLoopProxy<UserEvent>) -> Self {
        // A short debounce coalesces a save's burst of events into one reload;
        // kept small so the reload still feels immediate.
        let debouncer = new_debouncer(
            Duration::from_millis(200),
            move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    for event in events {
                        let _ = proxy.send_event(UserEvent::FileChanged(event.path));
                    }
                }
            },
        );
        let debouncer = match debouncer {
            Ok(debouncer) => Some(debouncer),
            Err(error) => {
                eprintln!("Live reload disabled: could not start file watcher: {error}");
                None
            }
        };
        Self {
            debouncer,
            last_active: None,
            watched: HashMap::new(),
            active_hash: None,
        }
    }

    /// Point the watcher at the active document's folder and, when given, the
    /// Project view's folder (recursively). Cheap after every event: diffs the
    /// desired set against what's watched and no-ops when nothing changed.
    pub(crate) fn sync(&mut self, active_path: Option<&Path>, project_dir: Option<&Path>) {
        if active_path != self.last_active.as_deref() {
            // Active document changed, so the stored hash is stale; force a render.
            self.active_hash = None;
            self.last_active = active_path.map(Path::to_path_buf);
        }

        let desired = desired_watches(active_path, project_dir);
        if desired == self.watched {
            return;
        }

        // Collect changes before borrowing the debouncer, so its mutable borrow
        // doesn't overlap the immutable borrow of `watched`.
        let to_unwatch: Vec<PathBuf> = self
            .watched
            .iter()
            .filter(|(path, mode)| desired.get(*path) != Some(*mode))
            .map(|(path, _)| path.clone())
            .collect();
        let to_watch: Vec<(PathBuf, RecursiveMode)> = desired
            .iter()
            .filter(|(path, mode)| self.watched.get(*path) != Some(*mode))
            .map(|(path, mode)| (path.clone(), *mode))
            .collect();

        if let Some(debouncer) = self.debouncer.as_mut() {
            for path in &to_unwatch {
                let _ = debouncer.watcher().unwatch(path);
            }
            for (path, mode) in &to_watch {
                if let Err(error) = debouncer.watcher().watch(path, *mode) {
                    eprintln!("Live reload: failed to watch {}: {error}", path.display());
                }
            }
        }
        self.watched = desired;
    }
}

/// The directories to watch and each one's recursive mode: the Project folder
/// recursively, plus the active document's folder when not already covered.
pub(crate) fn desired_watches(
    active_path: Option<&Path>,
    project_dir: Option<&Path>,
) -> HashMap<PathBuf, RecursiveMode> {
    let mut desired = HashMap::new();
    if let Some(dir) = project_dir.and_then(watch_folder) {
        desired.insert(dir, RecursiveMode::Recursive);
    }
    if let Some(dir) = active_path.and_then(watch_dir_for) {
        let covered = desired.iter().any(|(watched, mode)| {
            matches!(mode, RecursiveMode::Recursive) && dir.starts_with(watched)
        });
        if !covered {
            desired.entry(dir).or_insert(RecursiveMode::NonRecursive);
        }
    }
    desired
}

/// The directory to watch for a document: its parent, canonicalized. `None`
/// when the path has no usable parent (never falls back to a huge ancestor).
pub(crate) fn watch_dir_for(path: &Path) -> Option<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())?;
    Some(fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf()))
}

/// Canonicalize a folder to watch directly (not its parent). `None` for an
/// empty path or a non-directory, so a doomed watch is never attempted.
pub(crate) fn watch_folder(path: &Path) -> Option<PathBuf> {
    if path.as_os_str().is_empty() || !path.is_dir() {
        return None;
    }
    Some(fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()))
}

/// Hash of file contents, to detect whether a changed-on-disk document actually
/// differs from what's rendered. Not cryptographic or persisted.
pub(crate) fn content_hash(contents: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    contents.hash(&mut hasher);
    hasher.finish()
}

/// Re-render the active document from disk, preserving scroll position. Reads
/// the file once and hash-gates, so a spurious event with unchanged contents
/// re-renders nothing.
pub(crate) fn reload_active_document(
    window: &tao::window::Window,
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    recent: &RecentFiles,
    file_watch: &mut FileWatch,
    local_image_source_dir_state: &Arc<Mutex<Option<PathBuf>>>,
) {
    let Some(index) = workspace.active else {
        return;
    };
    let Some(path) = workspace
        .tabs
        .get(index)
        .and_then(|tab| tab.history.current().cloned())
    else {
        return;
    };

    // An external change must not clobber unsaved edits: if this document's edit
    // buffer is dirty, leave it and the view alone.
    let has_dirty_buffer = workspace.tabs.get(index).is_some_and(|tab| {
        tab.has_edit_for(&path) && tab.edit.as_ref().is_some_and(EditableDocument::is_dirty)
    });
    if has_dirty_buffer {
        return;
    }

    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        // May be mid-save or briefly absent during an atomic rename; a later
        // event delivers the settled contents.
        Err(error) => {
            eprintln!("Live reload: failed to read {}: {error}", path.display());
            return;
        }
    };

    let hash = content_hash(&contents);
    if file_watch.active_hash == Some(hash) {
        return;
    }
    file_watch.active_hash = Some(hash);

    // Keep this document's clean edit buffer in step with the file. If the code
    // view is open, refresh its source in place rather than reverting to reading.
    let in_code_view = workspace.tabs.get(index).is_some_and(|tab| tab.code_view);
    let buffer_is_current = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.has_edit_for(&path));
    if let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
        .filter(|_| buffer_is_current)
    {
        edit.adopt_external(contents.clone());
        if in_code_view {
            let highlighted = edit.source_view_html();
            let text = edit.text().to_string();
            let language = edit.format.language_token().to_string();
            let display = edit.format.display_name().to_string();
            if let Some(webview) = webview {
                if let Err(error) = webview.evaluate_script(&code_view_script(
                    &highlighted,
                    &text,
                    &language,
                    &display,
                    false,
                    // Live reload refreshes in place; the page keeps its scroll.
                    None,
                )) {
                    eprintln!("Live reload: failed to refresh code view: {error}");
                }
            }
            return;
        }
    }

    // Render through the same path as an initial open, reusing the content
    // already read for the hash-gate.
    let document = opened_document_from_source(&contents, &path);
    if let Some(tab) = workspace.tabs.get_mut(index) {
        tab.title = document.title.clone();
    }
    window.set_title(&format!("{} - Leaf Text", document.title));

    let image_source_path = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    update_local_image_source_dir(
        local_image_source_dir_state,
        local_image_source_dir(&image_source_path),
    );

    let tabs = workspace.tab_summaries();
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&workspace_reload_script(
            &recent.files,
            &tabs,
            Some(index),
            Some(&document),
        )) {
            eprintln!("Live reload: failed to update document view: {error}");
        }
    }
}
