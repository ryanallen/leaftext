//! Watching the open file and its folder, and reloading on change.

use super::*;

/// Turns filesystem changes into `UserEvent::FileChanged` for the active document's directory (live-reload) and for the folder the library pane shows. Watches the parent directory, not the file, to survive editors that save by renaming a temp file over the original.
#[derive(Default)]
pub(crate) struct FileWatch {
    pub(crate) debouncer: Option<Debouncer<RecommendedWatcher>>,
    pub(crate) last_active: Option<PathBuf>,
    /// Directories currently registered with the watcher and their recursive mode; the diff against the desired set on each `sync` is (un)watched.
    pub(crate) watched: HashMap<PathBuf, RecursiveMode>,
    /// Hash of the contents last rendered for the active document, so a reload skips redundant work when a spurious event arrives for unchanged content.
    pub(crate) active_hash: Option<u64>,
    /// The folder the open document sits in, in the form the watcher reports paths in. Shared with the handler thread because that is the one exception to the generated-folder refusal: a README read out of `node_modules` is still a document somebody is looking at.
    pub(crate) reading_in: Arc<Mutex<Option<PathBuf>>>,
}

impl FileWatch {
    pub(crate) fn new(proxy: EventLoopProxy<UserEvent>) -> Self {
        let reading_in: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
        let handler_reading_in = Arc::clone(&reading_in);
        // A short debounce coalesces a save's burst of events into one reload; kept small so the reload still feels immediate.
        let debouncer = new_debouncer(
            Duration::from_millis(200),
            move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    for event in events {
                        if is_git_bookkeeping(&event.path) {
                            continue;
                        }
                        if is_generated_output(&event.path, &handler_reading_in) {
                            continue;
                        }
                        let _ =
                            proxy.send_event(UserEvent::FileChanged(plain_event_path(event.path)));
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
            reading_in,
        }
    }

    /// Point the watcher at the active document's folder and, when given, the library pane's folder (recursively). Cheap after every event: diffs the desired set against what's watched and no-ops when nothing changed.
    pub(crate) fn sync(
        &mut self,
        active_path: Option<&Path>,
        project_dir: Option<&Path>,
        mode: RecursiveMode,
    ) {
        if active_path != self.last_active.as_deref() {
            // Active document changed, so the stored hash is stale; force a render.
            self.active_hash = None;
            self.last_active = active_path.map(Path::to_path_buf);
            // And the handler's one exception moves with it. Canonicalized and then put back in plain form, because that is how an event's path reaches the handler.
            if let Ok(mut reading_in) = self.reading_in.lock() {
                *reading_in = active_path.and_then(watch_dir_for).map(plain_event_path);
            }
        }

        let desired = desired_watches(active_path, project_dir, mode);
        if desired == self.watched {
            return;
        }

        // Collect changes before borrowing the debouncer, so its mutable borrow doesn't overlap the immutable borrow of `watched`.
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

    /// Drop the watch on a folder that is about to be deleted, and on anything under it.
    ///
    /// A recursive watch reports every file in a folder as it goes: 2,000 files measured as 2,020 events, and every one of them reaches the loop, where a vault being active spends a thread on `git status` before the active-document split. None of it is news — the folder is going — so the watch comes off first and [`Self::sync`] puts back whatever is still wanted at the end of the same turn.
    pub(crate) fn release(&mut self, folder: &Path) {
        // Watches are registered canonicalized, so the plain path a vault row carries has to be put in the same form before it can be compared with one.
        let folder = fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
        let leaving: Vec<PathBuf> = self
            .watched
            .keys()
            .filter(|watched| watched.starts_with(&folder))
            .cloned()
            .collect();
        if leaving.is_empty() {
            return;
        }
        if let Some(debouncer) = self.debouncer.as_mut() {
            for path in &leaving {
                let _ = debouncer.watcher().unwatch(path);
            }
        }
        for path in &leaving {
            self.watched.remove(path);
        }
    }
}

/// Whether a change is git's own bookkeeping: a `.git` folder, a `.git` file (a submodule or a worktree keeps one), or anything inside either.
///
/// Filtered here at the boundary rather than in one of the loop's arms, because both arms answer wrong for it and one of them is what wrote it. Reading a vault's git state runs `git status`, which modifies `.git`; a vault is watched recursively, so that write comes back as an event, which reads the vault's git state again — the app answering its own write for ever. The pane's arm is no better placed to refuse it: `.git` sits directly inside the folder on screen, so it looks exactly like a document to [`change_affects_pane`]. And nothing under `.git` is ever news for either — no document the reader can open, no row the pane can draw.
///
/// A component equal to `.git`, never a prefix: `.gitignore` is a file somebody edits, and `.github` is a folder full of them.
pub(crate) fn is_git_bookkeeping(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == ".git")
}

/// Whether a change is one a machine wrote into a folder that says so — build output, a package cache, a virtual environment.
///
/// Refused here beside git's own bookkeeping and for the same reason: a recursive watch cannot be told to leave a subtree out, `notify` offers no exclusion and neither does the Windows call under it, so the events arrive whatever the walk decided and the only place to stop them costing anything is the boundary. Every one that gets past here runs the loop's whole tail as well as an arm — measured at 236µs of that tail plus 106µs of arm, per event, with one tab open.
///
/// **The document being read is the exception.** A README opened out of `node_modules`, or generated documentation opened out of `build`, is a document somebody is looking at, and live reload has to keep working for it. The folder is compared rather than the file, so a sibling changing still refreshes the pane the way it does anywhere else.
pub(crate) fn is_generated_output(path: &Path, reading_in: &Arc<Mutex<Option<PathBuf>>>) -> bool {
    if !leaftext::path_holds_generated_files(path) {
        return false;
    }
    let plain = plain_event_path(path.to_path_buf());
    let reading_in = reading_in.lock().ok();
    !reading_in
        .and_then(|open| open.clone())
        .is_some_and(|open| plain.parent() == Some(open.as_path()))
}

/// An event's path in the plain form the rest of the app compares against.
///
/// Watched directories are canonicalized, which on Windows puts them in the `\\?\` verbatim form — and the watcher reports every event in the form the watch was registered with. The pane's folder and the vault's root are held plain, and both are checked with plain equality, so an untranslated event matches nothing: a file appearing in the shown folder never refreshes the pane, and the vault's text is never patched. Translate once, here at the boundary. On macOS every absolute path starts with `/`, so this is a no-op.
pub(crate) fn plain_event_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(share) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{share}"));
    }
    if let Some(plain) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(plain.to_string());
    }
    path
}

/// The directories to watch and each one's mode: the pane's root in `mode`, plus the active document's folder when not already covered.
///
/// `mode` is the caller's, not a constant, and the distinction is load-bearing. A vault is watched **recursively** — the user chose that folder, so its size is their business, and the corpus underneath it has to stay live. A folder the pane merely browsed to is watched **non-recursively**: the pane shows one level, so one level is all it needs, and browsing to `C:\` must not subscribe to every change on the drive.
pub(crate) fn desired_watches(
    active_path: Option<&Path>,
    project_dir: Option<&Path>,
    mode: RecursiveMode,
) -> HashMap<PathBuf, RecursiveMode> {
    let mut desired = HashMap::new();
    if let Some(dir) = project_dir.and_then(watch_folder) {
        desired.insert(dir, mode);
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

/// The directory to watch for a document: its parent, canonicalized. `None` when the path has no usable parent (never falls back to a huge ancestor).
pub(crate) fn watch_dir_for(path: &Path) -> Option<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())?;
    Some(fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf()))
}

/// Canonicalize a folder to watch directly (not its parent). `None` for an empty path or a non-directory, so a doomed watch is never attempted.
pub(crate) fn watch_folder(path: &Path) -> Option<PathBuf> {
    if path.as_os_str().is_empty() || !path.is_dir() {
        return None;
    }
    Some(fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()))
}

/// Hash of file contents, to detect whether a changed-on-disk document actually differs from what's rendered. Not cryptographic or persisted.
pub(crate) fn content_hash(contents: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    contents.hash(&mut hasher);
    hasher.finish()
}

/// Whether an event has nothing to act on because the buffer already holds exactly what is on disk.
///
/// `active_hash` is cleared whenever the active document changes, so the first event after an open never matches it — and the whole folder is watched, so one usually arrives about something else. Ungated, that rebuilds the whole view for a file nobody touched. A dirty buffer never claims to match, so an outside change over unsaved edits is still reconciled.
pub(crate) fn buffer_already_shows(edit: Option<&EditableDocument>, contents: &str) -> bool {
    edit.is_some_and(|edit| !edit.is_dirty() && edit.text() == contents)
}

/// Whether the page still shows what `contents` holds for `path` in `tab`.
///
/// Answered from what the page was actually drawn from: this tab's edit buffer where it has one for this document, and the tab's last render otherwise. A tab with neither has nothing to stand on, so it counts as moved — asking [`FileWatch::active_hash`] instead would say "moved" for every freshly opened document, since that hash is `None` until something reloads or saves.
///
/// A buffer holding unsaved edits says yes: the disk cannot move a page the reader is typing into, and [`reload_active_document`] refuses one anyway.
pub(crate) fn page_shows_file(tab: &Tab, path: &Path, contents: &str) -> bool {
    if let Some(edit) = tab.edit.as_ref().filter(|_| tab.has_edit_for(path)) {
        return edit.is_dirty() || edit.text() == contents;
    }
    tab.rendered
        .as_ref()
        .is_some_and(|cache| cache.answers_for(path, content_hash(contents)))
}

/// Bring the view back in step with the disk before an answer carrying offsets read off the page is handed over.
///
/// A modal dialog blocks the loop, so the file can move while it stands open and the answer reaches the page ahead of any queued reload — offsets then spent against text the page has never seen. Reading the disk here rather than taking the pending change first is what covers both ways in: a document with no edit buffer seeds one from disk on the write itself, and that path raises no watcher event at all.
///
/// When the file moved, the reload redraws, and the redraw is what clears the page's pending writer — so the answer that follows has nothing to write with and is dropped. When it did not, nothing is redrawn.
pub(crate) fn reload_if_file_moved(reader: &mut Reader, file_watch: &mut FileWatch) {
    let Some(index) = reader.workspace.active else {
        return;
    };
    let Some(path) = reader
        .workspace
        .tabs
        .get(index)
        .and_then(|tab| tab.history.current().cloned())
    else {
        return;
    };
    // Unreadable mid-save or briefly gone: leave the page as it is rather than dropping the answer over a read that would have settled.
    let Ok(source) = read_source(&path) else {
        return;
    };
    let still_shown = reader
        .workspace
        .tabs
        .get(index)
        .is_some_and(|tab| page_shows_file(tab, &path, &source.text));
    if still_shown {
        return;
    }
    // The page has been established stale, so the reload's own hash gate must not be allowed to wave it through: that hash records the last reload, not what is on the page.
    file_watch.active_hash = None;
    reload_active_document(reader, file_watch);
}

/// Re-render the active document from disk, preserving scroll position. Reads the file once and hash-gates, so a spurious event with unchanged contents re-renders nothing.
pub(crate) fn reload_active_document(reader: &mut Reader, file_watch: &mut FileWatch) {
    let workspace = &mut reader.workspace;
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

    // An external change must not clobber unsaved edits: if this document's edit buffer is dirty, leave it and the view alone.
    let has_dirty_buffer = workspace.tabs.get(index).is_some_and(|tab| {
        tab.has_edit_for(&path) && tab.edit.as_ref().is_some_and(EditableDocument::is_dirty)
    });
    if has_dirty_buffer {
        return;
    }

    let source = match read_source(&path) {
        Ok(source) => source,
        // May be mid-save or briefly absent during an atomic rename; a later event delivers the settled contents.
        Err(error) => {
            eprintln!("Live reload: failed to read {}: {error}", path.display());
            return;
        }
    };
    let contents = source.text.clone();

    let hash = content_hash(&contents);
    if file_watch.active_hash == Some(hash) {
        return;
    }
    file_watch.active_hash = Some(hash);

    // Keep this document's clean edit buffer in step with the file. If the code view is open, refresh its source in place rather than reverting to reading.
    let in_code_view = workspace.tabs.get(index).is_some_and(|tab| tab.code_view);
    let buffer_is_current = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.has_edit_for(&path));

    let shown = workspace
        .tabs
        .get(index)
        .and_then(|tab| tab.edit.as_ref())
        .filter(|_| buffer_is_current);
    if buffer_already_shows(shown, &contents) {
        return;
    }
    if let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
        .filter(|_| buffer_is_current)
    {
        edit.adopt_external(source.clone());
        if in_code_view {
            let text = edit.text().to_string();
            let language = edit.format.language_token().to_string();
            let display = edit.format.display_name().to_string();
            let url = stage_source_payload(code_view_payload(
                &text, &language, &display, false,
                // Live reload refreshes in place; the page keeps its scroll.
                None,
            ));
            run_page_script(
                reader.webview.as_ref(),
                &code_view_fetch_script(&url),
                "Live reload: failed to refresh code view",
            );
            return;
        }
    }

    // Render through the same path as an initial open, reusing the content already read for the hash-gate.
    let document = opened_document_from_source_with_host(&contents, &path, &DesktopHost::default());
    if let Some(tab) = workspace.tabs.get_mut(index) {
        tab.title = document.title.clone();
        // Cache it, so switching away and back doesn't redo this render.
        tab.rendered = Some(RenderedCache {
            path: path.clone(),
            hash,
            document: document.clone(),
        });
    }
    reader
        .window
        .set_title(&format!("{} - Leaftext", document.title));

    let image_source_path = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    if let Ok(mut current) = reader.image_dir.lock() {
        *current = local_image_source_dir(&image_source_path);
    }

    let tabs = reader.workspace.tab_summaries();
    run_page_script(
        reader.page(),
        &workspace_reload_script(
            &reader.recent.files,
            &reader.favorites,
            &tabs,
            Some(index),
            Some(&document),
        ),
        "Live reload: failed to update document view",
    );
}
