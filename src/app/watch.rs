//! Watching the open file and its folder, and reloading on change.

use super::*;

/// Turns filesystem changes into `UserEvent::FileChanged` for the active document's directory (live-reload) and for the folder the library pane shows. Watches the parent directory, not the file, to survive editors that save by renaming a temp file over the original.
#[derive(Default)]
pub(crate) struct FileWatch {
    pub(crate) debouncer: Option<Debouncer<RecommendedWatcher>>,
    pub(crate) last_active: Option<PathBuf>,
    /// Directories currently registered with the watcher and their recursive mode; the diff against the desired set on each `sync` is (un)watched.
    pub(crate) watched: HashMap<PathBuf, RecursiveMode>,
    /// The three inputs [`Self::watched`] was last built from, held only where every one of them that named something produced a watch. `None` means the desired set has to be built from the disk again.
    built_from: Option<(Option<PathBuf>, Option<PathBuf>, RecursiveMode)>,
    /// Hash of the contents last rendered for the active document, so a reload skips redundant work when a spurious event arrives for unchanged content.
    pub(crate) active_hash: Option<u64>,
    /// The folder the open document sits in, in the form the watcher reports paths in. Shared with the handler thread because that is the one exception to the generated-folder refusal: a README read out of `node_modules` is still a document somebody is looking at.
    pub(crate) reading_in: Arc<Mutex<Option<PathBuf>>>,
}

impl FileWatch {
    pub(crate) fn new(proxy: EventLoopProxy<UserEvent>) -> Self {
        let reading_in: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
        let handler_reading_in = Arc::clone(&reading_in);
        // The reload waits until the path has been quiet for 200ms, so a save's burst of events costs one; kept short so the reload still feels immediate.
        let debouncer = new_debouncer(
            Duration::from_millis(200),
            move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    let changed = watched_changes(events, &handler_reading_in);
                    if !changed.is_empty() {
                        let _ = proxy.send_event(UserEvent::FileChanged(changed));
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
            built_from: None,
            active_hash: None,
            reading_in,
        }
    }

    /// Point the watcher at the active document's folder and, when given, the library pane's folder (recursively). Returns before touching the disk when the three inputs have not moved, and otherwise diffs the desired set against what's watched.
    ///
    /// The three inputs are the whole of what the set is built from, so a file changing on disk moves none of them — and the loop runs this after every event. Building it anyway asks the disk three times and throws the answer away as equal: 116µs an event before the gate, 0.7µs after.
    ///
    /// Two edges the gate leaves open. A folder that is not there yet produces no watch, so the inputs are remembered only where every one that named something did — otherwise a vault created after it was pointed at is never watched. And [`Self::release`] drops watches mid-turn for the sync at the end of that turn to put back, so it clears what is remembered here.
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

        let unmoved = self
            .built_from
            .as_ref()
            .is_some_and(|(active, project, built_mode)| {
                active.as_deref() == active_path
                    && project.as_deref() == project_dir
                    && *built_mode == mode
            });
        if unmoved {
            return;
        }

        let (desired, all_resolved) = desired_watches(active_path, project_dir, mode);
        self.built_from = all_resolved.then(|| {
            (
                active_path.map(Path::to_path_buf),
                project_dir.map(Path::to_path_buf),
                mode,
            )
        });

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
        // The watched set is about to stop matching the inputs it was built from, so [`Self::sync`] must build it again rather than recognize them and return.
        self.built_from = None;
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

/// What one event off the watcher becomes: the path to tell the loop about, or nothing where the change is git's own bookkeeping or something a machine wrote into a folder that says so.
///
/// The whole of the debouncer's decision, out where a test can ask it — the closure it is called from owns a proxy and a watcher and nothing here can build either. The translation happens here rather than in one consumer at a time, because every consumer of a change event compares plain paths.
pub(crate) fn watched_change(
    path: PathBuf,
    reading_in: &Arc<Mutex<Option<PathBuf>>>,
) -> Option<PathBuf> {
    if is_git_bookkeeping(&path) || is_generated_output(&path, reading_in) {
        return None;
    }
    Some(plain_event_path(path))
}

/// Keep every useful path from one debounced batch together for the loop.
///
/// A write still going at the deadline is reported twice: `AnyContinuous` while the writer still has the path, then `Any` once it has been quiet. Only the settled report is news — the first re-reads a file nobody has finished writing, and dropping it moves nothing later, because the second arrives when it always did.
pub(crate) fn watched_changes(
    events: impl IntoIterator<Item = DebouncedEvent>,
    reading_in: &Arc<Mutex<Option<PathBuf>>>,
) -> Vec<PathBuf> {
    events
        .into_iter()
        .filter(|event| event.kind == DebouncedEventKind::Any)
        .filter_map(|event| watched_change(event.path, reading_in))
        .collect()
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
///
/// Answers with the set and whether every input that named something produced a watch. A folder that is not there yet produces none, and [`FileWatch::sync`] must not take such inputs as settled or a vault created after it was pointed at would never be watched. The flag rides along because it is free here and costs the disk a second look anywhere else.
pub(crate) fn desired_watches(
    active_path: Option<&Path>,
    project_dir: Option<&Path>,
    mode: RecursiveMode,
) -> (HashMap<PathBuf, RecursiveMode>, bool) {
    let project_watch = project_dir.and_then(watch_folder);
    let active_dir = active_path.and_then(watch_dir_for);
    let all_resolved = project_watch.is_some() == project_dir.is_some()
        && active_dir.is_some() == active_path.is_some();

    let mut desired = HashMap::new();
    if let Some(dir) = project_watch {
        desired.insert(dir, mode);
    }
    if let Some(dir) = active_dir {
        let covered = desired.iter().any(|(watched, mode)| {
            matches!(mode, RecursiveMode::Recursive) && dir.starts_with(watched)
        });
        if !covered {
            desired.entry(dir).or_insert(RecursiveMode::NonRecursive);
        }
    }
    (desired, all_resolved)
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

/// How much of a package's end is read to ask whether it moved. A zip's end record is 22 bytes plus a comment nobody writes, and the directory in front of it runs about fifty bytes a member, so this holds a package of some six hundred parts — more than any of the real Office files this was built against.
const PACKAGE_TAIL_BYTES: u64 = 32 * 1024;

/// A package's identity, read off the directory at the end of the file: what it says about every member's bytes, without inflating one of them.
///
/// The tail is read and grown until the directory is wholly inside it, ending at the whole file. `None` for a format that is not a package, and for a package whose end could not be read as one — either way the caller falls back to hashing the text it drew.
fn package_identity(path: &Path) -> Option<u64> {
    use std::io::{Read, Seek};
    if !matches!(
        DocumentFormat::from_path(path).source_shape(),
        leaftext::SourceShape::Bytes
    ) {
        return None;
    }
    let mut file = fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let mut window = PACKAGE_TAIL_BYTES;
    loop {
        let at = length.saturating_sub(window);
        file.seek(std::io::SeekFrom::Start(at)).ok()?;
        let mut tail = Vec::new();
        file.read_to_end(&mut tail).ok()?;
        if let Some(identity) = leaftext::package_identity(&tail, at as usize) {
            return Some(identity);
        }
        if at == 0 {
            return None;
        }
        window = window.saturating_mul(4);
    }
}

/// What a render of `path` is keyed on, for a caller holding the text it drew: a package by the identity written in its own directory, every other format by that text.
///
/// One function, because the side writing a cache entry and the side asking whether the page is still current have to key on the same thing or the reader is left looking at a document the file no longer holds.
pub(crate) fn render_key(path: &Path, contents: &str) -> u64 {
    package_identity(path).unwrap_or_else(|| content_hash(contents))
}

/// The same key for a caller that has not read the file: `None` where only the text could have answered, so a gate standing in front of a read hands over `None` and still gets an answer for a package.
pub(crate) fn render_hash(path: &Path, contents: Option<&str>) -> Option<u64> {
    match contents {
        Some(contents) => Some(render_key(path, contents)),
        None => package_identity(path),
    }
}

/// Whether `tab`'s buffer for `path` holds the same archive the file does, asked on the identity a zip writes into its own directory rather than on any member's words.
///
/// A package's buffer holds one inflated member while the file is the whole archive, so the two can never be compared as text. What they do share is that identity: the file's comes off a tail read, the buffer's off the archive it is already carrying, and neither inflates anything.
///
/// `None` where the identity is not there to compare — no buffer for this document, a buffer carrying no archive, or a file whose tail will not read as a package, which is a mid-save or an atomic rename in flight. Whether the buffer is dirty is left to the callers, who answer it opposite ways.
pub(crate) fn package_buffer_matches_file(tab: &Tab, path: &Path) -> Option<bool> {
    let held = tab
        .edit
        .as_ref()
        .filter(|_| tab.has_edit_for(path))?
        .package()
        .and_then(|package| leaftext::package_identity(&package.bytes, 0))?;
    Some(render_hash(path, None)? == held)
}

/// Whether the file still holds what the last reload recorded, answered without opening it.
///
/// A package states what every member's bytes are in the directory at its own end, so this costs a read of the tail where the reload below costs the whole file and one member inflated out of it, which is what an event about an open document nothing wrote would otherwise spend to be told nothing had moved. A format that is its own text has no identity cheaper than its bytes, so [`render_hash`] answers `None` for it, this never holds, and the file is read exactly as it always was.
pub(crate) fn file_still_matches_last_reload(path: &Path, active_hash: Option<u64>) -> bool {
    render_hash(path, None).is_some_and(|identity| active_hash == Some(identity))
}

/// Whether an event has nothing to act on because the buffer already holds exactly what is on disk.
///
/// `active_hash` is cleared whenever the active document changes, so the first event after an open never matches it — and the whole folder is watched, so one usually arrives about something else. Ungated, that rebuilds the whole view for a file nobody touched. A dirty buffer never claims to match, so an outside change over unsaved edits is still reconciled.
pub(crate) fn buffer_already_shows(edit: Option<&EditableDocument>, contents: &str) -> bool {
    edit.is_some_and(|edit| !edit.is_dirty() && edit.text() == contents)
}

/// Whether the page still shows what `path` holds in `tab`, answered without the file's words wherever they are not what settles it.
///
/// Answered from what the page was actually drawn from: this tab's edit buffer where it has one for this document, and the tab's last render otherwise. A tab with neither has nothing to stand on, so it counts as moved — asking [`FileWatch::active_hash`] instead would say "moved" for every freshly opened document, since that hash is `None` until something reloads or saves.
///
/// A buffer holding unsaved edits says yes: the disk cannot move a page the reader is typing into, and [`reload_active_document`] refuses one anyway.
///
/// `contents` is what the file holds, where the caller has already read it. `None` answers `None` only on the one arm that has nothing but the words to go on — a text document, which has no identity cheaper than its own bytes — so a caller can ask first and read only if it must. A package answers either way off the identity at the end of its file, which is a 32 KB tail read rather than the whole archive and one member inflated out of it.
pub(crate) fn page_shows_file(tab: &Tab, path: &Path, contents: Option<&str>) -> Option<bool> {
    if let Some(edit) = tab.edit.as_ref().filter(|_| tab.has_edit_for(path)) {
        if edit.is_dirty() {
            return Some(true);
        }
        if let Some(matches) = package_buffer_matches_file(tab, path) {
            return Some(matches);
        }
        return contents.map(|contents| edit.text() == contents);
    }
    let Some(cache) = tab.rendered.as_ref() else {
        return Some(false);
    };
    Some(cache.answers_for(path, render_hash(path, contents)?))
}

/// Bring the view back in step with the disk before an answer carrying offsets read off the page is handed over.
///
/// A modal dialog blocks the loop, so the file can move while it stands open and the answer reaches the page ahead of any queued reload — offsets then spent against text the page has never seen. Looking at the disk here rather than taking the pending change first is what covers both ways in: a document with no edit buffer seeds one from disk on the write itself, and that path raises no watcher event at all.
///
/// The question comes before the read: a package answers off the identity at the end of its file, and only a text document is opened whole — which for a big Word file, spreadsheet or deck is every byte of it and one member inflated out of the archive, spent to produce words nothing then looks at.
///
/// When the file moved, the reload redraws, and the redraw is what clears the page's pending writer — so the answer that follows has nothing to write with and is dropped. When it did not, nothing is redrawn.
pub(crate) fn reload_if_file_moved(reader: &mut Reader, file_watch: &mut FileWatch) {
    let Some(index) = reader.workspace.active else {
        return;
    };
    let Some(tab) = reader.workspace.tabs.get(index) else {
        return;
    };
    let Some(path) = tab.history.current().cloned() else {
        return;
    };
    let still_shown = match page_shows_file(tab, &path, None) {
        Some(shown) => shown,
        // Only this document's own words can settle it. Unreadable mid-save or briefly gone: leave the page as it is rather than dropping the answer over a read that would have settled.
        None => {
            let Ok(source) = read_document_source(&path) else {
                return;
            };
            page_shows_file(tab, &path, Some(&source.text)).unwrap_or(false)
        }
    };
    if still_shown {
        return;
    }
    // The page has been established stale, so the reload's own hash gate must not be allowed to wave it through: that hash records the last reload, not what is on the page.
    file_watch.active_hash = None;
    reload_active_document(reader, file_watch);
}

/// Put the render a live reload just drew on the tab, so switching away and back doesn't redo it.
///
/// The archive comes from the source that reload read and from nothing else — not from the entry being replaced, nor from the buffer on screen, both of which hold the file as it was before the change, so a save splicing into either would write the old file back over the new one.
///
/// Where a clean edit buffer was open, that buffer has already taken the archive out of the source above and this entry carries none, which is the state a buffer opening over a render leaves behind anyway: the archive is the whole file and it sits in exactly one place. A later seed off such an entry reads the disk rather than being handed a second copy.
///
/// It stands on no file record: the file was read above, and a record taken after a read can describe a write that landed during it — a newer stamp beside older content, which is a stale render nothing ever clears. The next arrival reads once and earns one.
pub(crate) fn cache_reloaded_render(
    tab: &mut Tab,
    path: &Path,
    hash: u64,
    source: DocumentSource,
    document: Rc<OpenedDocument>,
) {
    tab.rendered = Some(RenderedCache {
        path: path.to_path_buf(),
        hash,
        record: None,
        package: source.package,
        document,
    });
}

/// Re-render the active document from disk, preserving scroll position. A package that has not moved is answered off its own directory without being opened; anything else is read once and hash-gated, so a spurious event with unchanged contents re-renders nothing.
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

    // In front of the read rather than behind it: an event about an open package is usually the app's own save coming back.
    if file_still_matches_last_reload(&path, file_watch.active_hash) {
        return;
    }

    let mut source = match read_document_for_editing(&path) {
        Ok(source) => source,
        // May be mid-save or briefly absent during an atomic rename; a later event delivers the settled contents.
        Err(error) => {
            eprintln!("Live reload: failed to read {}: {error}", path.display());
            return;
        }
    };
    // Read in place: both gates below take a borrowed string and keep none of it, and on a package this text is a whole inflated member.
    let contents: &str = &source.text.text;

    // The key the gate above reads, the key the save writes, and the key a tab's render cache is answered on are one key: written any other way, the gate compares an identity against a text hash and waves every event through.
    let hash = render_key(&path, contents);
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
    if buffer_already_shows(shown, contents) {
        return;
    }
    if let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
        .filter(|_| buffer_is_current)
    {
        // The archive as well as the text: a package's new member has to arrive with the archive it came out of, or the next save writes the stale one back. Moved rather than copied, because the archive is the whole file and belongs in exactly one place — the buffer, once one is open over it. No parse, since the buffer only drops it, and the render below picks its package arm off the parse rather than off the archive. The text alone is copied, because that render takes the source's own away.
        edit.adopt_external(DocumentSource {
            text: SourceText {
                text: source.text.text.clone(),
                spelling: source.text.spelling,
            },
            package: source.package.take(),
            document: None,
        });
        if in_code_view {
            let source_definition = leaftext::source_definition(&edit.path);
            let language = source_definition
                .map(|definition| definition.language_token)
                .unwrap_or(edit.format.language_token())
                .to_string();
            let display = source_definition
                .map(|definition| definition.display_name)
                .unwrap_or(edit.format.display_name())
                .to_string();
            // The buffer's own text, borrowed: the payload reads it and keeps none of it.
            let url = stage_page_payload(code_view_payload(
                edit.text(),
                &language,
                &display,
                false,
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

    // Render through the same path as an initial open, reusing the content already read for the hash-gate, and wrapped where it is drawn so the entry this reload writes and the document it draws with are one allocation.
    let document =
        match opened_document_for_path_with_host(&path, &mut source, &DesktopHost::default()) {
            Ok(document) => Rc::new(document),
            Err(error) => {
                eprintln!("Live reload: failed to read {}: {error}", path.display());
                return;
            }
        };
    if let Some(tab) = workspace.tabs.get_mut(index) {
        tab.title = document.title.clone();
        cache_reloaded_render(tab, &path, hash, source, Rc::clone(&document));
    }
    reader
        .window
        .set_title(&format!("{} - Leaftext", document.title));

    let image_source_path = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    if let Ok(mut current) = reader.image_dir.lock() {
        *current = local_image_source_dir(&image_source_path);
    }

    let tabs = reader.workspace.tab_summaries();
    run_workspace_payload(
        reader.page(),
        workspace_reload_message(
            &reader.recent.files,
            &reader.favorites,
            &tabs,
            Some(index),
            Some(&*document),
            Some(hash),
        ),
        "Live reload: failed to update document view",
    );
}
